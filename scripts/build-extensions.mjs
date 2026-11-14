// Copies the shared extension sources into the Chrome and Firefox extension folders.
import { copyFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'extensions')
const shared = join(root, 'shared')
for (const target of ['chrome', 'firefox']) {
  for (const f of readdirSync(shared)) copyFileSync(join(shared, f), join(root, target, f))
  console.log(`extensions/${target} updated`)
}
