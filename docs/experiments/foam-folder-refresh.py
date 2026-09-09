"""Diagnostic only: copy Foam 0.44.6 and refresh moved descendants after rename.
Never install this bundle or use it as released Foam compatibility evidence.
"""
from pathlib import Path
import shutil
import sys

source, destination = map(Path, sys.argv[1:])
if destination.exists():
    raise SystemExit('Destination must not exist')
bundle = source / 'out/bundles/extension-node.js'
text = bundle.read_text()
marker = 'async function rN(e,t){let r=await t;'
assert text.count(marker) == 1, 'Unexpected Foam bundle; refusing patch'
addition = '''e.subscriptions.push(Cs.workspace.onDidRenameFiles(async event=>{
  await r.services.matcher.refresh();
  for(const {newUri} of event.files){
    const stat=await Cs.workspace.fs.stat(newUri);
    const files=stat.type===Cs.FileType.Directory
      ? await Cs.workspace.findFiles(new Cs.RelativePattern(newUri,"**/*")) : [newUri];
    for(const file of files) if(r.services.matcher.isMatch(fr(file)))
      await r.workspace.fetchAndSet(fr(file));
  }
}));'''
shutil.copytree(source, destination)
(destination / 'out/bundles/extension-node.js').write_text(text.replace(marker, marker+addition))
print(destination)
