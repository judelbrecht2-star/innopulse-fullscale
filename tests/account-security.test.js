import { beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { createRequire } from "node:module";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let source;
beforeAll(async () => {
  const bundle = await build({
    entryPoints: ["app/settings/security/page.jsx"], bundle: true, write: false,
    platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react-dom", "next/*"],
    alias: { "@": process.cwd() },
    plugins: [{ name: "account-context", setup(b) {
      b.onResolve({ filter: /^\.\.\/context$/ }, () => ({ path: "settings", namespace: "fixture" }));
      b.onResolve({ filter: /lib\/supabase$/ }, () => ({ path: "supabase", namespace: "fixture" }));
      b.onLoad({ filter: /^supabase$/, namespace: "fixture" }, () => ({ contents: "export const sb = () => { throw new Error('No network access in account render tests'); };" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useSettings = () => globalThis.settings;" }));
    } }],
  });
  source = bundle.outputFiles[0].text;
});

function render(settings) {
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, require: createRequire(import.meta.url),
    process, console, Buffer, setTimeout, clearTimeout, URL, TextEncoder,
    settings: { loading: false, user: { id: "user", email: "person@example.test" }, role: "", orgSettings: null, ...settings },
  });
  return renderToStaticMarkup(React.createElement(module.exports.default));
}

it("offers password recovery and two-factor settings without a workspace membership", () => {
  const html = render({ workspaceErr: "Your user isn't linked to an organisation yet." });
  expect(html).toContain("New password");
  expect(html).toContain("Repeat new password");
  expect(html).toContain("Change password");
  expect(html).toContain("Two-factor authentication");
  expect(html).toContain("You can still manage your password");
});

it("keeps password settings available if personal preferences could not load", () => {
  expect(render({ prefsErr: "Preferences unavailable" })).toContain("New password");
});

it("blocks credential controls when the authenticated user cannot be verified", () => {
  const html = render({ authErr: "Session unavailable" });
  expect(html).toContain("Session unavailable");
  expect(html).not.toContain("New password");
});
