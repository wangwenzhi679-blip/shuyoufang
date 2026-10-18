// Override for deployments where the API is hosted separately.
export const API_ROOT = String(import.meta.env?.VITE_API_BASE || '/api').replace(/\/+$/, '');
