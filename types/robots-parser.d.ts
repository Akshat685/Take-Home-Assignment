declare module "robots-parser" {
  export interface RobotsParser {
    isAllowed(url: string, userAgent?: string): boolean | undefined;
    getCrawlDelay(userAgent?: string): number | undefined;
  }

  export default function robotsParser(url: string, contents: string): RobotsParser;
}
