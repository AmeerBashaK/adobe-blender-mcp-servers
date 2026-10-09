var c = findComp(ARGS.comp);
var t = ARGS.time !== undefined ? ARGS.time : c.time;
var f = new File(__MCP_WORKDIR + '/frame-' + new Date().getTime() + '.png');
c.saveFrameToPng(t, f);
return { __image: f.fsName, comp: c.name, time: t, width: c.width, height: c.height };