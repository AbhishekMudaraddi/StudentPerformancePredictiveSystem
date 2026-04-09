# Student Prediction UI (React + Vite)

Client-side rendered React app for uploading a CSV, converting rows to `records`, calling the prediction API, and rendering results.

## Run locally

```bash
npm install
npm run dev
```

## Build for static hosting (S3)

```bash
npm run build
```

Upload the `dist/` contents to your S3 bucket configured for static website hosting.

## Important for S3/browser calls

Because API calls now happen directly from the browser, your API endpoint must allow CORS for your frontend origin.

