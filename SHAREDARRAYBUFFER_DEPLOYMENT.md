# SharedArrayBuffer Deployment Requirements

## CRITICAL: Cross-Origin Isolation Headers Required

SharedArrayBuffer is used for zero-copy communication between Go WASM and JavaScript.
These headers **MUST** be set on the server for SharedArrayBuffer to work:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### Development Server (✅ Already Configured)

Headers are configured in `angular.json` under `serve.options.headers`.

### Production Deployment

You MUST configure these headers in your production environment:

#### Netlify (`netlify.toml`)
```toml
[[headers]]
  for = "/*"
  [headers.values]
    Cross-Origin-Opener-Policy = "same-origin"
    Cross-Origin-Embedder-Policy = "require-corp"
```

#### Vercel (`vercel.json`)
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
      ]
    }
  ]
}
```

#### Nginx
```nginx
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "require-corp" always;
```

#### Apache (.htaccess)
```apache
Header set Cross-Origin-Opener-Policy "same-origin"
Header set Cross-Origin-Embedder-Policy "require-corp"
```

## Additional Requirements

### HTTPS Required
SharedArrayBuffer only works in **secure contexts**:
- ✅ `https://` (production)
- ✅ `http://localhost` (development)
- ❌ `http://` (non-localhost)

### External Resources
Any external resources (fonts, images, scripts) must either:
1. Be served from the same origin, OR
2. Have `Cross-Origin-Resource-Policy: cross-origin` header

**Google Fonts**: May need to be self-hosted or loaded differently.

## Verification

Check in browser console:
```javascript
console.log('crossOriginIsolated:', crossOriginIsolated);
// Should be: true
```

## Fallback

If SharedArrayBuffer is not available, the system falls back to JSON serialization.
Check `isSharedArrayBufferAvailable()` in `shared-buffer.ts`.
