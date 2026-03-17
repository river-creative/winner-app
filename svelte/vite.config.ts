import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 6001,
		proxy: {
			'/api': {
				target: 'http://localhost:3001',
				changeOrigin: true,
				cookieDomainRewrite: 'localhost'
			},
			'/uploads': {
				target: 'http://localhost:3001',
				changeOrigin: true
			}
		}
	}
});
