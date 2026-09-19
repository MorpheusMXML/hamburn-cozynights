// tests/hook-module.ts — loads a pb_hooks module the way PocketBase's JSVM
// does: CommonJS, with `require` for the modules in pb_hooks/lib and the
// `__hooks` global (the pb_hooks directory). For the unit tests of the hooks'
// logic, which run outside PocketBase.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

export const HOOKS_DIR = fileURLToPath(new URL('../pb_hooks', import.meta.url));

/** @param file a path relative to pb_hooks (like 'lib/notify.js') or an absolute one */
export function loadHookModule(
	file: string,
	globals: Record<string, unknown> = {}
): Record<string, any> {
	const resolved = path.isAbsolute(file) ? file : path.join(HOOKS_DIR, file);
	const source = fs.readFileSync(resolved, 'utf8');
	const module = { exports: {} as Record<string, any> };
	const require = (target: string) =>
		loadHookModule(
			path.isAbsolute(target) ? target : path.resolve(path.dirname(resolved), target),
			globals
		);
	vm.runInNewContext(
		source,
		{ module, exports: module.exports, console, require, __hooks: HOOKS_DIR, ...globals },
		{ filename: path.basename(resolved) }
	);
	return module.exports;
}
