var doc = findDoc(ARGS.document);
var n = doc.name;
doc.close(ARGS.save ? SaveOptions.SAVECHANGES : SaveOptions.DONOTSAVECHANGES);
return { closed: n, saved: !!ARGS.save };
