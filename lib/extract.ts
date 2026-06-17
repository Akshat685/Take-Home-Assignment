import * as cheerio from "cheerio";

export type ExtractedPage = {
  title: string;
  text: string;
  links: string[];
};

function cleanWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function structuredText($: cheerio.CheerioAPI, element: any): string {
  const root = $(element);
  const pieces = root
    .find("h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th")
    .map((_, child) => cleanWhitespace($(child).text()))
    .get()
    .filter((line) => line.length > 20);

  if (pieces.length > 0) {
    return pieces.join("\n");
  }

  return cleanWhitespace(root.text());
}

function removeLikelyBoilerplate($: cheerio.CheerioAPI): void {
  $("script,style,noscript,svg,iframe,canvas,template,nav,footer,form,button,input,select,textarea,aside").remove();
  $("[role='navigation'],[role='banner'],[role='contentinfo'],[aria-hidden='true']").remove();

  $("*").each((_, element) => {
    const node = $(element);
    const marker = `${node.attr("id") ?? ""} ${node.attr("class") ?? ""} ${node.attr("aria-label") ?? ""}`;

    if (/(cookie|consent|gdpr|newsletter|subscribe|popup|modal|advert|ad-|promo|social-share)/i.test(marker)) {
      node.remove();
    }
  });
}

export function extractPage(html: string): ExtractedPage {
  const $ = cheerio.load(html);

  const links = $("a[href]")
    .map((_, anchor) => $(anchor).attr("href")?.trim())
    .get()
    .filter(Boolean);

  const title = cleanWhitespace($("title").first().text()) || cleanWhitespace($("h1").first().text()) || "Untitled page";

  removeLikelyBoilerplate($);

  const candidates = ["main", "article", "[role='main']", "#content", ".content", ".post", ".page", "body"];
  let bestText = "";

  for (const selector of candidates) {
    $(selector).each((_, element) => {
      const text = structuredText($, element);
      if (text.length > bestText.length) {
        bestText = text;
      }
    });
  }

  return {
    title,
    text: cleanWhitespace(bestText.replace(/\n+/g, "\n")),
    links
  };
}
