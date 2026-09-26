/* The About page's provider rows, as markup. */
import { describe, it, expect } from "vitest";
import { DATA_PROVIDERS } from "../data/attributions.js";
import { sourceRowHtml, dataSourcesHtml } from "./render-sources.js";

describe("sourceRowHtml", () => {
  const html = sourceRowHtml(DATA_PROVIDERS[0]);

  it("names the provider, links it safely, and keeps the arrow decorative", () => {
    expect(html).toContain("<b>Open-Meteo</b>");
    expect(html).toContain('href="https://open-meteo.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(">open-meteo.com ");
  });

  it("carries the translation key for its description and one palette tone", () => {
    expect(html).toContain('data-i18n="srcOm"');
    expect(html.match(/tone-\w+/g)).toEqual(["tone-primary"]);
  });

  it("escapes anything it prints", () => {
    const row = sourceRowHtml({
      id: "x",
      name: "<script>alert(1)</script>",
      url: 'https://example.com/"onmouseover="x',
      host: "example.com",
      logo: "X",
      tone: "primary",
      blurb: "srcOm",
    });
    expect(row).not.toContain("<script>");
    expect(row).not.toContain('"onmouseover="');
  });
});

describe("dataSourcesHtml", () => {
  it("draws one row per provider, in list order", () => {
    const html = dataSourcesHtml();
    expect(html.match(/class="src-row"/g)).toHaveLength(DATA_PROVIDERS.length);
    const names = [...html.matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1]);
    expect(names).toEqual(DATA_PROVIDERS.map((p) => p.name));
  });

  it("draws nothing for an empty list", () => {
    expect(dataSourcesHtml([])).toBe("");
  });
});
