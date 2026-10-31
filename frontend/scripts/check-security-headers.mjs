const url = process.env.CHECK_URL ?? "http://127.0.0.1:5173/login";
const media = process.env.MEDIA_ORIGIN;
const errors = [];

const res = await fetch(url);
if (res.status !== 200) errors.push(`status ${res.status}, expected 200`);

const csp = res.headers.get("content-security-policy") ?? "";
const directive = (name) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";

for (const needle of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "worker-src 'self' blob:"]) {
  if (!csp.includes(needle)) errors.push(`CSP missing ${needle}`);
}
if (media) {
  for (const name of ["connect-src", "img-src"]) {
    if (!directive(name).split(" ").includes(media)) errors.push(`CSP ${name} missing ${media}`);
  }
}
if (csp.includes("'unsafe-eval'")) errors.push("CSP contains 'unsafe-eval'");

if (res.headers.get("x-content-type-options") !== "nosniff") errors.push("x-content-type-options is not nosniff");
if (!/max-age=\d{7,}/.test(res.headers.get("strict-transport-security") ?? "")) errors.push("strict-transport-security missing or too short");
if (res.headers.get("referrer-policy") !== "same-origin") errors.push("referrer-policy is not same-origin");

for (const e of errors) console.error(`FAIL ${e}`);
if (errors.length) process.exit(1);
console.log("security headers ok");
