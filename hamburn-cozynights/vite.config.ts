import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { buildDefine } from './build-info';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// The version badge and /api/health read these ($lib/version).
	define: buildDefine,
	server: {
		port: 5173,
		strictPort: false
	}
});
