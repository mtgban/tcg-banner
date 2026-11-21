import { test, expect, describe } from "bun:test";
import { readFileSync, readdirSync, existsSync, statSync } from "fs";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const pkg = JSON.parse(read("package.json"));

function files(dir) {
  const at = new URL(dir + "/", root);
  if (!existsSync(at)) {
    return [];
  }
  return readdirSync(at).flatMap((name) => {
    const path = dir + "/" + name;
    return statSync(new URL(path, root)).isDirectory() ? files(path) : [path];
  });
}

describe("the manifest", () => {
  test("asks for no permissions", () => {
    for (const key of [
      "permissions",
      "optional_permissions",
      "host_permissions",
      "optional_host_permissions",
      "background",
      "web_accessible_resources",
    ]) {
      expect(manifest[key]).toBeUndefined();
    }
  });

  test("names only files that exist", () => {
    const named = Object.values(manifest.icons);
    for (const cs of manifest.content_scripts) {
      named.push(...(cs.js || []), ...(cs.css || []));
    }
    expect(named.filter((name) => !existsSync(new URL(name, root)))).toEqual([]);
  });

  test("runs on the order history and nowhere else", () => {
    expect(manifest.content_scripts.flatMap((cs) => cs.matches)).toEqual([
      "https://store.tcgplayer.com/myaccount/orderhistory*",
    ]);
  });

  test("carries package.json's version", () => {
    expect(manifest.version).toBe(pkg.version);
  });
});

describe("the source", () => {
  test("calls no extension API", () => {
    const calling = files("src").filter((name) => /\b(chrome|browser)\.\w/.test(read(name)));
    expect(calling).toEqual([]);
  });

  test("names no site but TCGplayer's and mtgban's", () => {
    const urls = files("src").flatMap((name) =>
      [...read(name).matchAll(/https?:\/\/[^/"'\s)\\]+/g)].map((m) => name + ": " + m[0])
    );
    expect(urls.filter((url) => !/: https:\/\/(store\.tcgplayer\.com|tcgplayer-cdn\.tcgplayer\.com)$/.test(url))).toEqual([]);
  });
});

describe("the panel", () => {
  test("is one fixed width", () => {
    const css = read("src/panel.css");
    const rule = /#tcg-banner \{([^}]*)\}/.exec(css)[1];
    expect(rule).toMatch(/\swidth: 240px;/);
    expect(css + read("src/orders.css")).not.toMatch(/(min|max)-width/);
  });
});

describe("punctuation", () => {
  test("no em dash in the source, the docs or the config", () => {
    const names = [
      ...files("src"),
      ...files("scripts"),
      ...files("tests").filter((name) => !name.startsWith("tests/fixtures/") && name !== "tests/repo.test.js"),
      ...files(".github"),
      ...files("docs"),
      "README.md",
      "SPECIFICATIONS.md",
      "AGENTS.md",
      "manifest.json",
      "package.json",
    ];
    const dashed = names.filter((name) => {
      const text = read(name);
      return text.includes("—") || text.includes("\\u2014") || text.includes("&mdash;");
    });
    expect(dashed).toEqual([]);
  });
});

describe("fixtures", () => {
  test("carry no session, address or tracking data", () => {
    // Fixtures are cut from saved pages of a signed-in account. What a cut
    // must never keep is checked here, on every fixture there is.
    const leaks = [];
    for (const name of files("tests/fixtures")) {
      const text = read(name);
      const tokens = [...text.matchAll(/name="__RequestVerificationToken"[^>]*value="([^"]*)"|value="([^"]*)"[^>]*name="__RequestVerificationToken"/g)].map((m) => m[1] ?? m[2]);
      if (tokens.some((value) => value !== "TOKEN")) leaks.push(name + ": a real token");
      if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) leaks.push(name + ": an email address");
      if (/\d{15,}/.test(text)) leaks.push(name + ": a 15-plus digit run");
      if (/[A-Za-z0-9]{30,}/.test(text)) leaks.push(name + ": a 30-plus character token");
      if (/shipment\.co|Track Package|SHIP TO<\/span><br>\s*\S|BILL TO<\/span><br>\s*\S/.test(text)) leaks.push(name + ": an address or tracking");
      if (/Welcome, |Store Credit/.test(text)) leaks.push(name + ": the account's welcome line");
      if (/sellerfeedback\/(?!0000)/.test(text)) leaks.push(name + ": a real seller");
    }
    expect(leaks).toEqual([]);
  });
});
