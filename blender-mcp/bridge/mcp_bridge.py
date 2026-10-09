"""Blender side of the Blender MCP server.

Installed into Blender's scripts/startup folder (see ../install.ps1), so it starts with Blender.
It listens on 127.0.0.1 (port 9876 by default) for one-line JSON requests from server.ps1:

    {"token": "...", "tool": "create_object", "args": {...}}

and answers with one JSON line: {"ok": true, "text": "...", "image": "<png path>"}.
Requests are queued and run on Blender's main thread by a timer, because bpy is not thread-safe.
A random token (written to %LOCALAPPDATA%/blender-mcp/session.json) keeps other local
processes from driving Blender through the socket.
"""

import ast
import contextlib
import io
import json
import math
import os
import queue
import secrets
import socket
import tempfile
import threading
import time
import traceback

import bpy
import mathutils

PORT = int(os.environ.get("BLENDER_MCP_PORT", "9876"))
STATE_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir(), "blender-mcp")
SESSION_FILE = os.path.join(STATE_DIR, "session.json")
WORK_DIR = os.path.join(tempfile.gettempdir(), "blender-mcp")

_queue = queue.Queue()
_state = {"sock": None, "token": None, "running": False}


# ---- Helpers ----------------------------------------------------------------

def r3(v):
    return round(float(v), 4)


def vec(v):
    return [r3(x) for x in v]


def deg(euler):
    return [round(math.degrees(a), 3) for a in euler]


def rad(v):
    return [math.radians(a) for a in v]


def hex_color(h, alpha=1.0):
    """'#rrggbb' or [r, g, b] (0-1 or 0-255) -> linear RGBA tuple for Blender."""
    if isinstance(h, str):
        h = h.lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    else:
        srgb = list(h[:3])
        if any(c > 1 for c in srgb):
            srgb = [c / 255 for c in srgb]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (lin[0], lin[1], lin[2], alpha)


def to_hex(rgba):
    out = []
    for c in rgba[:3]:
        c = max(0.0, min(1.0, c))
        s = c * 12.92 if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055
        out.append("%02x" % round(s * 255))
    return "#" + "".join(out)


def get_obj(name):
    if not name:
        obj = bpy.context.view_layer.objects.active
        if obj:
            return obj
        raise ValueError('Pass "name"; there is no active object.')
    obj = bpy.data.objects.get(name)
    if not obj:
        raise ValueError("Object not found: %s" % name)
    return obj


def ctx():
    """A window/area/region override so operators that need a UI context work from the timer."""
    wm = bpy.context.window_manager
    for win in wm.windows:
        for area in win.screen.areas:
            if area.type == "VIEW_3D":
                region = next((r for r in area.regions if r.type == "WINDOW"), None)
                return {"window": win, "screen": win.screen, "area": area, "region": region}
    if wm.windows:
        return {"window": wm.windows[0], "screen": wm.windows[0].screen}
    return {}


def run_op(op, **kw):
    with bpy.context.temp_override(**ctx()):
        return op(**kw)


def engine_id(name):
    items = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys()
    name = (name or "").lower()
    if name.startswith("eevee"):
        for k in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
            if k in items:
                return k
    if name == "cycles":
        return "CYCLES"
    if name == "workbench":
        return "BLENDER_WORKBENCH"
    if name.upper() in items:
        return name.upper()
    raise ValueError("Unknown engine %s (eevee, cycles, workbench)" % name)


def describe(obj, deep=False):
    o = {
        "name": obj.name,
        "type": obj.type,
        "location": vec(obj.location),
        "rotation": deg(obj.rotation_euler),
        "scale": vec(obj.scale),
        "dimensions": vec(obj.dimensions),
    }
    if obj.parent:
        o["parent"] = obj.parent.name
    if obj.hide_get() if obj.name in bpy.context.view_layer.objects else False:
        o["hidden"] = True
    if obj.users_collection:
        o["collection"] = obj.users_collection[0].name
    mats = [s.material.name for s in obj.material_slots if s.material]
    if mats:
        o["materials"] = mats
    if obj.type == "LIGHT":
        o["light"] = {"type": obj.data.type, "energy": r3(obj.data.energy), "color": to_hex(obj.data.color)}
    elif obj.type == "CAMERA":
        o["camera"] = {"lens": r3(obj.data.lens), "active": bpy.context.scene.camera == obj}
    elif obj.type == "FONT":
        o["text"] = obj.data.body
    if deep:
        if obj.type == "MESH":
            me = obj.data
            o["mesh"] = {"vertices": len(me.vertices), "edges": len(me.edges), "faces": len(me.polygons)}
        o["modifiers"] = [{"name": m.name, "type": m.type} for m in obj.modifiers]
        if obj.animation_data and obj.animation_data.action:
            act = obj.animation_data.action
            curves = []
            try:
                fcs = act.fcurves
            except AttributeError:
                fcs = []
                for layer in getattr(act, "layers", []):
                    for strip in layer.strips:
                        for bag in getattr(strip, "channelbags", []):
                            fcs.extend(bag.fcurves)
            for fc in fcs:
                curves.append({"path": fc.data_path, "index": fc.array_index,
                               "keys": [[r3(k.co[0]), r3(k.co[1])] for k in fc.keyframe_points][:50]})
            o["animation"] = {"action": act.name, "curves": curves}
        if obj.material_slots:
            o["material_details"] = [material_info(s.material) for s in obj.material_slots if s.material]
        if obj.children:
            o["children"] = [c.name for c in obj.children]
    return o


def principled(mat):
    if not mat.use_nodes:
        mat.use_nodes = True
    for n in mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            return n
    n = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    out = next((x for x in mat.node_tree.nodes if x.type == "OUTPUT_MATERIAL"), None)
    if out is None:
        out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(n.outputs[0], out.inputs[0])
    return n


def material_info(mat):
    o = {"name": mat.name}
    if mat.use_nodes:
        p = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if p:
            bc = p.inputs["Base Color"]
            o["color"] = to_hex(bc.default_value)
            if bc.is_linked:
                o["color_texture"] = True
            o["metallic"] = r3(p.inputs["Metallic"].default_value)
            o["roughness"] = r3(p.inputs["Roughness"].default_value)
    return o


def set_input(node, names, value):
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return True
    return False


def new_objects_since(before):
    return [o.name for o in bpy.data.objects if o.name not in before]


# ---- Tools --------------------------------------------------------------------

def t_get_scene_info(a):
    sc = bpy.context.scene
    r = sc.render
    objs = [describe(o) for o in sc.objects][: a.get("limit", 200)]
    return {
        "blender": bpy.app.version_string,
        "file": bpy.data.filepath or None,
        "scene": sc.name,
        "frame": {"current": sc.frame_current, "start": sc.frame_start, "end": sc.frame_end, "fps": r.fps},
        "render": {"engine": r.engine, "resolution": [r.resolution_x, r.resolution_y],
                   "percentage": r.resolution_percentage, "output": r.filepath},
        "camera": sc.camera.name if sc.camera else None,
        "active": bpy.context.view_layer.objects.active.name if bpy.context.view_layer.objects.active else None,
        "selected": [o.name for o in bpy.context.selected_objects] if hasattr(bpy.context, "selected_objects") else [],
        "collections": [c.name for c in bpy.data.collections],
        "object_count": len(sc.objects),
        "objects": objs,
    }


def t_get_object_info(a):
    return describe(get_obj(a.get("name")), deep=True)


PRIMS = {
    "cube": lambda s, a: bpy.ops.mesh.primitive_cube_add(size=s),
    "plane": lambda s, a: bpy.ops.mesh.primitive_plane_add(size=s),
    "sphere": lambda s, a: bpy.ops.mesh.primitive_uv_sphere_add(radius=s / 2, segments=a.get("segments", 64), ring_count=a.get("rings", 32)),
    "ico_sphere": lambda s, a: bpy.ops.mesh.primitive_ico_sphere_add(radius=s / 2, subdivisions=a.get("subdivisions", 3)),
    "cylinder": lambda s, a: bpy.ops.mesh.primitive_cylinder_add(radius=s / 2, depth=a.get("depth", s), vertices=a.get("segments", 64)),
    "cone": lambda s, a: bpy.ops.mesh.primitive_cone_add(radius1=s / 2, depth=a.get("depth", s), vertices=a.get("segments", 64)),
    "torus": lambda s, a: bpy.ops.mesh.primitive_torus_add(major_radius=s / 2, minor_radius=a.get("minor_radius", s / 8)),
    "circle": lambda s, a: bpy.ops.mesh.primitive_circle_add(radius=s / 2, fill_type=a.get("fill", "NGON")),
    "grid": lambda s, a: bpy.ops.mesh.primitive_grid_add(size=s, x_subdivisions=a.get("subdivisions", 10), y_subdivisions=a.get("subdivisions", 10)),
    "monkey": lambda s, a: bpy.ops.mesh.primitive_monkey_add(size=s),
}


def t_create_object(a):
    t = (a.get("type") or "cube").lower()
    size = float(a.get("size", 2 if t in ("cube", "plane", "monkey", "grid") else 2))
    loc = a.get("location", [0, 0, 0])
    default_coll = bpy.context.view_layer.active_layer_collection.collection
    coll = bpy.data.collections.get(a["collection"]) if a.get("collection") else default_coll
    if a.get("collection") and coll is None:
        coll = bpy.data.collections.new(a["collection"])
        bpy.context.scene.collection.children.link(coll)

    if t in PRIMS:
        with bpy.context.temp_override(**ctx()):
            PRIMS[t](size, a)
        obj = bpy.context.view_layer.objects.active
        if coll is not default_coll:
            for c in list(obj.users_collection):
                c.objects.unlink(obj)
            coll.objects.link(obj)
    else:
        if t == "text":
            data = bpy.data.curves.new(a.get("name", "Text"), type="FONT")
            data.body = a.get("text", "Text")
            data.size = a.get("size", 1.0)
            data.extrude = a.get("extrude", 0.05)
            data.bevel_depth = a.get("bevel", 0.0)
            data.align_x = a.get("align", "CENTER").upper()
            data.align_y = "CENTER"
            if a.get("font"):
                data.font = bpy.data.fonts.load(a["font"], check_existing=True)
        elif t == "empty":
            data = None
        elif t == "camera":
            data = bpy.data.cameras.new(a.get("name", "Camera"))
            data.lens = a.get("lens", 50)
        elif t in ("light", "point", "sun", "spot", "area"):
            lt = a.get("light_type", t if t != "light" else "point").upper()
            data = bpy.data.lights.new(a.get("name", "Light"), type=lt)
            data.energy = a.get("energy", 5 if lt == "SUN" else 1000)
            if a.get("color"):
                data.color = hex_color(a["color"])[:3]
            if lt == "AREA":
                data.size = a.get("light_size", 2)
        else:
            raise ValueError("Unknown type %s. Use cube, plane, sphere, ico_sphere, cylinder, cone, torus, circle, grid, monkey, text, empty, camera, light (point/sun/spot/area)." % t)
        obj = bpy.data.objects.new(a.get("name", t.capitalize()), data)
        coll.objects.link(obj)
        bpy.context.view_layer.objects.active = obj

    obj.location = loc
    if "rotation" in a:
        obj.rotation_euler = rad(a["rotation"])
    if "scale" in a:
        s = a["scale"]
        obj.scale = [s, s, s] if isinstance(s, (int, float)) else s
    if a.get("name"):
        obj.name = a["name"]
        if obj.data is not None and hasattr(obj.data, "name"):
            obj.data.name = a["name"]
    if a.get("smooth") and obj.type == "MESH":
        for p in obj.data.polygons:
            p.use_smooth = True
    if obj.type == "CAMERA" and a.get("active", True):
        bpy.context.scene.camera = obj
    if a.get("look_at") is not None and obj.type in ("CAMERA", "LIGHT", "EMPTY"):
        look_at(obj, a["look_at"])
    if a.get("color") and obj.type in ("MESH", "CURVE", "FONT", "SURFACE", "META"):
        t_set_material({"object": obj.name, "color": a["color"]})
    return describe(obj)


def look_at(obj, target):
    if isinstance(target, str):
        target = get_obj(target).matrix_world.translation
    bpy.context.view_layer.update()
    direction = mathutils.Vector(target) - obj.matrix_world.translation
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def t_modify_object(a):
    obj = get_obj(a.get("name"))
    if "location" in a:
        obj.location = a["location"]
    if "move_by" in a:
        obj.location = obj.location + mathutils.Vector(a["move_by"])
    if "rotation" in a:
        obj.rotation_euler = rad(a["rotation"])
    if "scale" in a:
        s = a["scale"]
        obj.scale = [s, s, s] if isinstance(s, (int, float)) else s
    if "dimensions" in a:
        obj.dimensions = a["dimensions"]
    if a.get("look_at") is not None:
        look_at(obj, a["look_at"])
    if "parent" in a:
        if a["parent"]:
            p = get_obj(a["parent"])
            mw = obj.matrix_world.copy()
            obj.parent = p
            obj.matrix_world = mw
        else:
            mw = obj.matrix_world.copy()
            obj.parent = None
            obj.matrix_world = mw
    if "hidden" in a:
        obj.hide_set(bool(a["hidden"]))
        obj.hide_render = bool(a["hidden"])
    if a.get("shade") in ("smooth", "flat") and obj.type == "MESH":
        for p in obj.data.polygons:
            p.use_smooth = a["shade"] == "smooth"
    if obj.type == "FONT" and "text" in a:
        obj.data.body = a["text"]
    if obj.type == "LIGHT":
        if "energy" in a:
            obj.data.energy = a["energy"]
        if "color" in a:
            obj.data.color = hex_color(a["color"])[:3]
    if obj.type == "CAMERA":
        if "lens" in a:
            obj.data.lens = a["lens"]
        if a.get("active"):
            bpy.context.scene.camera = obj
    if a.get("select"):
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
    if a.get("apply_transform"):
        for o in bpy.context.view_layer.objects:
            o.select_set(o == obj)
        bpy.context.view_layer.objects.active = obj
        run_op(bpy.ops.object.transform_apply, location=False, rotation=True, scale=True)
    if a.get("new_name"):
        obj.name = a["new_name"]
    return describe(obj)


def t_delete_objects(a):
    names = a.get("names") or ([a["name"]] if a.get("name") else [])
    if not names:
        raise ValueError('Pass "names"')
    done = []
    for n in names:
        o = bpy.data.objects.get(n)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)
            done.append(n)
    return {"deleted": done, "missing": [n for n in names if n not in done]}


def t_duplicate_object(a):
    src = get_obj(a.get("name"))
    out = []
    for i in range(int(a.get("count", 1))):
        o = src.copy()
        if src.data is not None and not a.get("linked"):
            o.data = src.data.copy()
        for c in src.users_collection:
            c.objects.link(o)
        if a.get("offset"):
            o.location = src.location + mathutils.Vector(a["offset"]) * (i + 1)
        out.append(o.name)
    return {"created": out}


def t_set_material(a):
    obj = get_obj(a.get("object"))
    name = a.get("material") or (obj.name + " Material")
    mat = bpy.data.materials.get(name) if a.get("material") else None
    if mat is None:
        if obj.active_material and not a.get("material") and not a.get("new"):
            mat = obj.active_material
        else:
            mat = bpy.data.materials.new(name)
    p = principled(mat)
    if "color" in a:
        p.inputs["Base Color"].default_value = hex_color(a["color"])
        mat.diffuse_color = hex_color(a["color"])
    if "metallic" in a:
        p.inputs["Metallic"].default_value = a["metallic"]
    if "roughness" in a:
        p.inputs["Roughness"].default_value = a["roughness"]
    if "emission" in a:
        set_input(p, ("Emission Color", "Emission"), hex_color(a["emission"]))
        set_input(p, ("Emission Strength",), a.get("emission_strength", 5))
    elif "emission_strength" in a:
        set_input(p, ("Emission Strength",), a["emission_strength"])
    if "transmission" in a:
        set_input(p, ("Transmission Weight", "Transmission"), a["transmission"])
    if "alpha" in a:
        p.inputs["Alpha"].default_value = a["alpha"]
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "DITHERED" if a["alpha"] < 1 else mat.surface_render_method
        elif hasattr(mat, "blend_method"):
            mat.blend_method = "BLEND" if a["alpha"] < 1 else "OPAQUE"
    if a.get("image"):
        nt = mat.node_tree
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(a["image"], check_existing=True)
        tex.location = (p.location.x - 350, p.location.y)
        nt.links.new(tex.outputs["Color"], p.inputs["Base Color"])
    if obj.data is not None and hasattr(obj.data, "materials"):
        slot = a.get("slot")
        if slot is not None and slot < len(obj.data.materials):
            obj.data.materials[slot] = mat
        elif obj.active_material is not mat:
            if len(obj.data.materials) and not a.get("append"):
                obj.data.materials[obj.active_material_index] = mat
            else:
                obj.data.materials.append(mat)
    return {"object": obj.name, "material": material_info(mat)}


def t_add_modifier(a):
    obj = get_obj(a.get("object"))
    mtype = a["type"].upper()
    m = obj.modifiers.new(a.get("name", mtype.title()), mtype)
    for k, v in (a.get("params") or {}).items():
        if k in ("object", "mirror_object", "offset_object", "target") and isinstance(v, str):
            v = get_obj(v)
        if not hasattr(m, k):
            raise ValueError("Modifier %s has no setting %r" % (mtype, k))
        setattr(m, k, v)
    if a.get("apply"):
        bpy.context.view_layer.objects.active = obj
        name = m.name
        run_op(bpy.ops.object.modifier_apply, modifier=name)
        return {"object": obj.name, "applied": name}
    return {"object": obj.name, "modifier": m.name, "type": m.type}


def t_animate(a):
    obj = get_obj(a.get("object"))
    sc = bpy.context.scene
    if "frame_start" in a:
        sc.frame_start = a["frame_start"]
    if "frame_end" in a:
        sc.frame_end = a["frame_end"]
    if "fps" in a:
        sc.render.fps = a["fps"]
    prop = a.get("property", "location")
    target = obj
    path = prop
    if prop in ("energy", "color", "lens"):
        target = obj.data
    keys = a.get("keyframes") or []
    for k in keys:
        v = k["value"]
        if prop == "rotation" or prop == "rotation_euler":
            path = "rotation_euler"
            v = rad(v)
        elif prop == "scale" and isinstance(v, (int, float)):
            v = [v, v, v]
        elif prop == "color":
            v = hex_color(v)[:3]
        setattr(target, path, v)
        target.keyframe_insert(data_path=path, frame=k["frame"])
    interp = (a.get("interpolation") or "").upper()
    if interp and target.animation_data and target.animation_data.action:
        act = target.animation_data.action
        fcs = getattr(act, "fcurves", None)
        if fcs is None:
            fcs = []
            for layer in getattr(act, "layers", []):
                for strip in layer.strips:
                    for bag in getattr(strip, "channelbags", []):
                        fcs.extend(bag.fcurves)
        for fc in fcs:
            if fc.data_path == path:
                for kp in fc.keyframe_points:
                    kp.interpolation = interp
    if a.get("clear"):
        target.animation_data_clear()
        return {"object": obj.name, "cleared": True}
    return {"object": obj.name, "property": path, "keyframes": len(keys), "frame_range": [sc.frame_start, sc.frame_end]}


def t_set_world(a):
    sc = bpy.context.scene
    w = sc.world or bpy.data.worlds.new("World")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = next((n for n in nt.nodes if n.type == "BACKGROUND"), None)
    out = next((n for n in nt.nodes if n.type == "OUTPUT_WORLD"), None)
    if bg is None:
        bg = nt.nodes.new("ShaderNodeBackground")
    if out is None:
        out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs[0], out.inputs[0])
    if a.get("hdri"):
        env = next((n for n in nt.nodes if n.type == "TEX_ENVIRONMENT"), None) or nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(a["hdri"], check_existing=True)
        nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    elif "color" in a:
        for l in list(bg.inputs["Color"].links):
            nt.links.remove(l)
        bg.inputs["Color"].default_value = hex_color(a["color"])
    if "strength" in a:
        bg.inputs["Strength"].default_value = a["strength"]
    return {"world": w.name, "strength": r3(bg.inputs["Strength"].default_value)}


def t_render_settings(a):
    sc = bpy.context.scene
    r = sc.render
    if "engine" in a:
        r.engine = engine_id(a["engine"])
    if "resolution" in a:
        r.resolution_x, r.resolution_y = a["resolution"]
    if "percentage" in a:
        r.resolution_percentage = a["percentage"]
    if "fps" in a:
        r.fps = a["fps"]
    if "frame_start" in a:
        sc.frame_start = a["frame_start"]
    if "frame_end" in a:
        sc.frame_end = a["frame_end"]
    if "transparent" in a:
        r.film_transparent = a["transparent"]
    if "samples" in a:
        if r.engine == "CYCLES":
            sc.cycles.samples = a["samples"]
        elif hasattr(sc, "eevee"):
            sc.eevee.taa_render_samples = a["samples"]
    if "output" in a:
        r.filepath = a["output"]
    if "format" in a:
        fmt = a["format"].upper()
        if fmt in ("MP4", "VIDEO"):
            r.image_settings.file_format = "FFMPEG"
            r.ffmpeg.format = "MPEG4"
            r.ffmpeg.codec = "H264"
        else:
            r.image_settings.file_format = {"JPG": "JPEG", "EXR": "OPEN_EXR"}.get(fmt, fmt)
    if "view_transform" in a:
        sc.view_settings.view_transform = a["view_transform"]
    return {"engine": r.engine, "resolution": [r.resolution_x, r.resolution_y], "percentage": r.resolution_percentage,
            "fps": r.fps, "frames": [sc.frame_start, sc.frame_end], "transparent": r.film_transparent,
            "output": r.filepath, "format": r.image_settings.file_format}


@contextlib.contextmanager
def _saved_render(sc):
    r = sc.render
    saved = (r.filepath, r.resolution_percentage, r.image_settings.file_format, r.use_file_extension)
    cyc = sc.cycles.samples if r.engine == "CYCLES" else None
    eev = sc.eevee.taa_render_samples if hasattr(sc, "eevee") else None
    try:
        yield
    finally:
        r.filepath, r.resolution_percentage, r.image_settings.file_format, r.use_file_extension = saved
        if cyc is not None:
            sc.cycles.samples = cyc
        if eev is not None:
            sc.eevee.taa_render_samples = eev


def t_render_preview(a):
    sc = bpy.context.scene
    if not sc.camera:
        raise ValueError("The scene has no active camera. Create one (create_object type=camera) or use viewport_screenshot.")
    r = sc.render
    max_size = a.get("max_size", 800)
    path = os.path.join(WORK_DIR, "render_%d.png" % int(time.time() * 1000))
    with _saved_render(sc):
        longest = max(r.resolution_x, r.resolution_y)
        r.resolution_percentage = max(1, min(100, int(max_size * 100 / longest)))
        r.image_settings.file_format = "PNG"
        r.filepath = path
        r.use_file_extension = False
        samples = a.get("samples", 16)
        if r.engine == "CYCLES":
            sc.cycles.samples = min(sc.cycles.samples, samples)
        elif hasattr(sc, "eevee"):
            sc.eevee.taa_render_samples = min(sc.eevee.taa_render_samples, samples)
        if "frame" in a:
            sc.frame_set(a["frame"])
        run_op(bpy.ops.render.render, write_still=True)
    return {"__image": path, "engine": r.engine, "camera": sc.camera.name, "frame": sc.frame_current}


def t_render(a):
    sc = bpy.context.scene
    if not sc.camera:
        raise ValueError("The scene has no active camera.")
    r = sc.render
    if a.get("path"):
        r.filepath = a["path"]
    if a.get("animation"):
        run_op(bpy.ops.render.render, animation=True)
        return {"rendered": "animation", "frames": [sc.frame_start, sc.frame_end], "output": bpy.path.abspath(r.filepath)}
    if "frame" in a:
        sc.frame_set(a["frame"])
    run_op(bpy.ops.render.render, write_still=True)
    return {"rendered": "still", "frame": sc.frame_current, "output": bpy.path.abspath(r.filepath)}


def t_viewport_screenshot(a):
    c = ctx()
    if "area" not in c:
        raise ValueError("No 3D Viewport is open in Blender.")
    path = os.path.join(WORK_DIR, "viewport_%d.png" % int(time.time() * 1000))
    if a.get("frame_selected") or a.get("view"):
        with bpy.context.temp_override(**c):
            if a.get("view"):
                bpy.ops.view3d.view_axis(type=a["view"].upper())
            if a.get("frame_selected"):
                bpy.ops.view3d.view_all()
    with bpy.context.temp_override(**c):
        bpy.ops.screen.screenshot_area(filepath=path)
    return {"__image": path}


IMPORTERS = {
    ".obj": lambda p: bpy.ops.wm.obj_import(filepath=p),
    ".stl": lambda p: bpy.ops.wm.stl_import(filepath=p),
    ".ply": lambda p: bpy.ops.wm.ply_import(filepath=p),
    ".fbx": lambda p: bpy.ops.import_scene.fbx(filepath=p),
    ".glb": lambda p: bpy.ops.import_scene.gltf(filepath=p),
    ".gltf": lambda p: bpy.ops.import_scene.gltf(filepath=p),
    ".usd": lambda p: bpy.ops.wm.usd_import(filepath=p),
    ".usdz": lambda p: bpy.ops.wm.usd_import(filepath=p),
    ".usdc": lambda p: bpy.ops.wm.usd_import(filepath=p),
    ".abc": lambda p: bpy.ops.wm.alembic_import(filepath=p),
    ".svg": lambda p: bpy.ops.import_curve.svg(filepath=p),
}


def t_import_file(a):
    p = a["path"]
    ext = os.path.splitext(p)[1].lower()
    if not os.path.exists(p):
        raise ValueError("File not found: %s" % p)
    before = set(o.name for o in bpy.data.objects)
    if ext in (".png", ".jpg", ".jpeg", ".webp"):
        img = bpy.data.images.load(p, check_existing=True)
        w, h = img.size
        with bpy.context.temp_override(**ctx()):
            bpy.ops.mesh.primitive_plane_add(size=1)
        obj = bpy.context.view_layer.objects.active
        obj.name = os.path.splitext(os.path.basename(p))[0]
        obj.scale = (a.get("size", 2) * w / max(w, h), a.get("size", 2) * h / max(w, h), 1)
        t_set_material({"object": obj.name, "image": p, "new": True, "material": obj.name})
    elif ext in IMPORTERS:
        with bpy.context.temp_override(**ctx()):
            IMPORTERS[ext](p)
    else:
        raise ValueError("Unsupported import type %s" % ext)
    return {"imported": new_objects_since(before)}


def t_export_file(a):
    p = a["path"]
    ext = os.path.splitext(p)[1].lower()
    os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
    sel_only = bool(a.get("objects"))
    if sel_only:
        for o in bpy.context.view_layer.objects:
            o.select_set(o.name in a["objects"])
    with bpy.context.temp_override(**ctx()):
        if ext == ".obj":
            bpy.ops.wm.obj_export(filepath=p, export_selected_objects=sel_only)
        elif ext == ".stl":
            bpy.ops.wm.stl_export(filepath=p, export_selected_objects=sel_only)
        elif ext == ".ply":
            bpy.ops.wm.ply_export(filepath=p, export_selected_objects=sel_only)
        elif ext == ".fbx":
            bpy.ops.export_scene.fbx(filepath=p, use_selection=sel_only)
        elif ext in (".glb", ".gltf"):
            bpy.ops.export_scene.gltf(filepath=p, use_selection=sel_only,
                                      export_format="GLB" if ext == ".glb" else "GLTF_SEPARATE")
        elif ext in (".usd", ".usdc", ".usdz"):
            bpy.ops.wm.usd_export(filepath=p, selected_objects_only=sel_only)
        else:
            raise ValueError("Unsupported export type %s (obj, stl, ply, fbx, glb, gltf, usd)" % ext)
    return {"exported": p}


def t_file(a):
    act = a.get("action", "save")
    if act == "save":
        path = a.get("path") or bpy.data.filepath
        if not path:
            raise ValueError('This file has never been saved; pass "path" (e.g. D:/work/scene.blend).')
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        run_op(bpy.ops.wm.save_as_mainfile, filepath=path)
        return {"saved": path}
    if act == "open":
        run_op(bpy.ops.wm.open_mainfile, filepath=a["path"])
        return {"opened": a["path"]}
    if act == "new":
        run_op(bpy.ops.wm.read_homefile, use_empty=bool(a.get("empty")))
        return {"new": True, "objects": [o.name for o in bpy.context.scene.objects]}
    raise ValueError("Unknown action %s (save, open, new)" % act)


def t_undo(a):
    n = int(a.get("steps", 1))
    op = bpy.ops.ed.redo if a.get("redo") else bpy.ops.ed.undo
    for _ in range(n):
        run_op(op)
    return {"steps": n, "redo": bool(a.get("redo"))}


def t_run_python(a):
    code = a["code"]
    g = {"bpy": bpy, "mathutils": mathutils, "math": math, "C": bpy.context, "D": bpy.data,
         "get_obj": get_obj, "describe": describe, "hex_color": hex_color, "run_op": run_op, "ctx": ctx}
    buf = io.StringIO()
    tree = ast.parse(code, mode="exec")
    last = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last = ast.Expression(tree.body.pop().value)
    with contextlib.redirect_stdout(buf):
        exec(compile(tree, "<mcp>", "exec"), g)
        value = eval(compile(last, "<mcp>", "eval"), g) if last is not None else g.get("result")
    out = {"stdout": buf.getvalue()} if buf.getvalue() else {}
    try:
        json.dumps(value)
        out["result"] = value
    except TypeError:
        out["result"] = repr(value)
    return out


TOOLS = {k[2:]: v for k, v in globals().items() if k.startswith("t_")}
READ_ONLY = {"get_scene_info", "get_object_info", "render_preview", "viewport_screenshot", "undo", "file", "export_file", "render"}


# ---- Plumbing -------------------------------------------------------------------

def _execute(req):
    name = req.get("tool")
    fn = TOOLS.get(name)
    if fn is None:
        return {"ok": False, "error": "Unknown tool: %s" % name}
    try:
        value = fn(req.get("args") or {})
        if name not in READ_ONLY:
            try:
                run_op(bpy.ops.ed.undo_push, message="MCP: " + name)
            except Exception:
                pass
        out = {"ok": True}
        if isinstance(value, dict) and value.get("__image"):
            out["image"] = value.pop("__image")
        out["text"] = json.dumps(value, indent=2, default=str)
        return out
    except Exception as e:
        return {"ok": False, "error": "%s: %s" % (type(e).__name__, e), "trace": traceback.format_exc(limit=4)}


def _pump():
    try:
        while True:
            req, done, holder = _queue.get_nowait()
            holder["res"] = _execute(req)
            done.set()
    except queue.Empty:
        pass
    return 0.05


def _handle(conn):
    try:
        conn.settimeout(30)
        data = b""
        while not data.endswith(b"\n"):
            chunk = conn.recv(65536)
            if not chunk:
                return
            data += chunk
        req = json.loads(data.decode("utf-8"))
        if req.get("token") != _state["token"]:
            res = {"ok": False, "error": "Bad token"}
        else:
            done, holder = threading.Event(), {}
            _queue.put((req, done, holder))
            if done.wait(float(req.get("timeout", 600))):
                res = holder["res"]
            else:
                res = {"ok": False, "error": "Blender did not finish within the timeout (it may still be working)."}
        conn.settimeout(None)
        conn.sendall((json.dumps(res) + "\n").encode("utf-8"))
    except Exception as e:
        try:
            conn.sendall((json.dumps({"ok": False, "error": str(e)}) + "\n").encode("utf-8"))
        except Exception:
            pass
    finally:
        conn.close()


def _serve(sock):
    while _state["running"]:
        try:
            conn, _ = sock.accept()
        except OSError:
            break
        threading.Thread(target=_handle, args=(conn,), daemon=True).start()


def start():
    if _state["running"] or bpy.app.background:
        return
    os.makedirs(STATE_DIR, exist_ok=True)
    os.makedirs(WORK_DIR, exist_ok=True)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1", PORT))
    except OSError:
        print("[mcp_bridge] port %d is busy (another Blender has the bridge); not starting." % PORT)
        sock.close()
        return
    sock.listen(8)
    _state.update(sock=sock, token=secrets.token_hex(16), running=True)
    with open(SESSION_FILE, "w") as f:
        json.dump({"port": PORT, "token": _state["token"], "pid": os.getpid()}, f)
    threading.Thread(target=_serve, args=(sock,), daemon=True).start()
    if not bpy.app.timers.is_registered(_pump):
        bpy.app.timers.register(_pump, persistent=True)
    print("[mcp_bridge] listening on 127.0.0.1:%d" % PORT)


def stop():
    _state["running"] = False
    if _state["sock"]:
        _state["sock"].close()
        _state["sock"] = None
    if bpy.app.timers.is_registered(_pump):
        bpy.app.timers.unregister(_pump)


def register():
    start()


def unregister():
    stop()
