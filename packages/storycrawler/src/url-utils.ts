/**
 *
 * Cuts search and hash parts of a URL off a URL
 *
 * @param url - An absolute URL, optionally with search and hash parts
 * @returns The input URl with the search and hash parts cau off
 *
 **/
export function getUrlWithoutSearchAndHash(url: string): string {
  // Do not use new URL(path, connectionUrl), to concatenate a path to a page to
  // the connection URL. The URL constructor would cut the last name on the path
  // as a file to append the new path to the last directory on the original path,
  // but the original implementation just appended '/iframe.html' to the
  // connection URL.
  const urlObject = new URL(url);
  urlObject.search = '';
  urlObject.hash = '';
  let baseUrl = urlObject.toString();
  if (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }
  return baseUrl;
}
