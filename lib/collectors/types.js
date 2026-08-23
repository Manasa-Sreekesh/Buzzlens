/**
 * @typedef {Object} CollectQuery
 * @property {string} topic
 * @property {string[]} keywords
 * @property {'24hours'|'7days'|'15days'|'30days'|'custom'} timePeriod  Default '30days'.
 * @property {string=} customStart
 * @property {string=} customEnd
 * @property {string[]=} communityUrls        Only used by the 'community' collector.
 * @property {{comment?: string, text?: string, author?: string, date?: string}=} communitySelectors
 * @property {string[]=} videoIds             Only used by the 'youtube' collector. When set, comments are
 *                                             collected from exactly these video IDs instead of a keyword
 *                                             search, and timePeriod is ignored (same as communityUrls).
 */

/**
 * @typedef {Object} RawItem
 * @property {string} id
 * @property {'youtube'|'reddit'|'twitter'|'community'} source
 * @property {string} contentTitle
 * @property {string} author
 * @property {string} text
 * @property {string} date          ISO 8601
 * @property {string} link
 * @property {string} sentiment     'positive'|'negative'|'neutral'
 * @property {string} theme
 * @property {number} engagement
 */

/**
 * @typedef {Object} CollectResult
 * @property {RawItem[]} items
 * @property {number} postCount
 * @property {'ok'|'partial'|'error'|'skipped'} status
 * @property {string=} errorMessage
 */

module.exports = {};
