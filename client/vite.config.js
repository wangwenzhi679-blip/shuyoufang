import { defineConfig } from 'vite';
export default defineConfig({
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8005', changeOrigin: false } } },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'editor-vendor',
              test: /node_modules[\\/]@tiptap|node_modules[\\/]prosemirror/,
              priority: 20,
            },
            {
              name: 'react-vendor',
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 15,
            },
            {
              name: 'icons-vendor',
              test: /node_modules[\\/]lucide-react[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
