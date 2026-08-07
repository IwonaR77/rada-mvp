// Custom server: runs plain Next.js on HTTP_PORT (unchanged default 3000)
// and, if a self-signed cert is present (scripts/gen-temp-ssl.sh), also on
// HTTPS_PORT — temporary until a real domain + Let's Encrypt cert exist.
// See node_modules/next/dist/docs/01-app/02-guides/custom-server.md.
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const next = require("next");

const HTTP_PORT = parseInt(process.env.PORT || "3000", 10);
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || "3443", 10);
const dev = process.env.NODE_ENV !== "production";

const CERT_DIR = path.join(__dirname, "certs");
const KEY_PATH = path.join(CERT_DIR, "localhost.key");
const CERT_PATH = path.join(CERT_DIR, "localhost.crt");

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  http.createServer((req, res) => handle(req, res)).listen(HTTP_PORT, () => {
    console.log(`> HTTP listening on http://localhost:${HTTP_PORT}`);
  });

  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
    const options = {
      key: fs.readFileSync(KEY_PATH),
      cert: fs.readFileSync(CERT_PATH),
    };
    https.createServer(options, (req, res) => handle(req, res)).listen(HTTPS_PORT, () => {
      console.log(`> HTTPS (self-signed, temporary) listening on https://localhost:${HTTPS_PORT}`);
    });
  } else {
    console.log(
      `> No cert at ${CERT_PATH} — skipping HTTPS. Run scripts/gen-temp-ssl.sh to enable it.`
    );
  }
});
