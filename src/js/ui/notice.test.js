import { describe, it, expect } from "vitest";
import { noticeHtml } from "./notice.js";

describe("noticeHtml", () => {
  it("reuses the advisory component's classes rather than a second banner look", () => {
    const html = noticeHtml({ title: "T", text: "X" });
    for (const cls of ["advisory", "adv-icon", "adv-body", "adv-title", "adv-desc"]) {
      expect(html).toContain(cls);
    }
  });

  it("maps tone onto the non-alarming advisory severities, never a red one", () => {
    expect(noticeHtml({ tone: "info", title: "T", text: "X" })).toContain("adv--low");
    expect(noticeHtml({ tone: "warn", title: "T", text: "X" })).toContain("adv--moderate");
    /* an unknown tone degrades to the quietest, not to red */
    const unknown = noticeHtml({ tone: "danger", title: "T", text: "X" });
    expect(unknown).toContain("adv--low");
    expect(unknown).not.toContain("adv--high");
  });

  it("escapes every string, so a place name in a message can't inject markup", () => {
    const html = noticeHtml({
      title: "<img src=x onerror=alert(1)>",
      text: '"><script>alert(1)</script>',
      action: { id: 'a"b', label: "<b>go</b>" },
      role: 'status" onclick="x',
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>go</b>");
    expect(html).not.toContain('onclick="x"');
  });

  it("renders an action button only when one is given", () => {
    expect(noticeHtml({ title: "T", text: "X" })).not.toContain("<button");
    const html = noticeHtml({ title: "T", text: "X", action: { id: "retry", label: "Retry" } });
    expect(html).toContain('data-notice-action="retry"');
    expect(html).toContain(">Retry</button>");
    /* a button that submits nothing and is a real, focusable control */
    expect(html).toContain('type="button"');
  });

  it("puts the role on the notice only when asked", () => {
    expect(noticeHtml({ title: "T", text: "X" })).not.toContain("role=");
    expect(noticeHtml({ title: "T", text: "X", role: "alert" })).toContain('role="alert"');
  });

  it("marks the icon decorative and never uses it as the only signal", () => {
    const html = noticeHtml({ tone: "warn", icon: "cloud", title: "Offline", text: "Details" });
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Offline");
  });
});
