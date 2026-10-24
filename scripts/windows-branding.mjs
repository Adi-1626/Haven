import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Use electron-builder's resource editor, without signing or altering the source runtime.
const require = createRequire(import.meta.url);
const { NtExecutable, NtExecutableResource, Resource } = require('resedit');

export async function brandExecutable(executable, version) {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Invalid application version');
  const exe = NtExecutable.from(await readFile(executable));
  const resources = NtExecutableResource.from(exe);
  const versions = Resource.VersionInfo.fromEntries(resources.entries);
  if (!versions.length) throw new Error('Executable has no Windows version resource');
  for (const info of versions) {
    for (const language of info.getAllLanguagesForStringValues()) {
      info.setFileVersion(`${version.split('-')[0]}.0`, language.lang);
      info.setProductVersion(`${version.split('-')[0]}.0`, language.lang);
      info.setStringValues(language, {
        ProductName: 'Haven', FileDescription: 'Haven', CompanyName: 'Haven',
        InternalName: 'Haven', OriginalFilename: 'Haven.exe',
        FileVersion: version, ProductVersion: version,
        LegalCopyright: 'Copyright © 2026 Haven',
      });
    }
    info.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(exe);
  await writeFile(executable, Buffer.from(exe.generate()));
}
