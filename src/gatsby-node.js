"use strict";

var _fetch = require("./fetch");

var _downloadMediaFiles = require("./download-media-files");

var _helpers = require("./helpers");

var _normalize = require("./normalize");

/**
 * Implement Gatsby's Node APIs in this file.
 *
 * See: https://www.gatsbyjs.com/docs/node-apis/
 */
// You can delete this file if you're not using it

/**
 * You can uncomment the following line to verify that
 * your plugin is being loaded in your site.
 *
 * See: https://www.gatsbyjs.com/docs/creating-a-local-plugin/#developing-a-local-plugin-that-is-outside-your-project
 */
const LAST_FETCHED_KEY = 'timestamp';

exports.onPreInit = () => console.log('Loaded gatsby-source-strapi-plugin');

exports.sourceNodes = async ({
  actions,
  createContentDigest,
  createNodeId,
  reporter,
  getCache,
  store,
  cache,
  getNodes,
  getNode
}, pluginOptions) => {
  const {
    schemas
  } = await (0, _fetch.fetchStrapiContentTypes)(pluginOptions);
  const {
    deleteNode,
    touchNode
  } = actions;
  const ctx = {
    strapiConfig: pluginOptions,
    actions,
    schemas,
    createContentDigest,
    createNodeId,
    reporter,
    getCache,
    getNode,
    getNodes,
    store,
    cache
  };
  const existingNodes = getNodes().filter(n => n.internal.owner === `gatsby-source-strapi` || n.internal.type === 'File');
  existingNodes.forEach(n => touchNode(n));
  const endpoints = (0, _helpers.getEndpoints)(pluginOptions, schemas);
  const lastFetched = await cache.get(LAST_FETCHED_KEY);
  const allResults = await Promise.all(endpoints.map(({
    kind,
    ...config
  }) => {
    if (kind === 'singleType') {
      return (0, _fetch.fetchEntity)(config, ctx);
    }

    return (0, _fetch.fetchEntities)(config, ctx);
  }));
  let newOrExistingEntries; // Fetch only the updated data between run

  if (lastFetched) {
    // Add the updatedAt filter
    const deltaEndpoints = endpoints.map(endpoint => {
      return { ...endpoint,
        queryParams: { ...endpoint.queryParams,
          // TODO
          filters: {
            updatedAt: {
              $gt: lastFetched
            }
          }
        }
      };
    });
    newOrExistingEntries = await Promise.all(deltaEndpoints.map(({
      kind,
      ...config
    }) => {
      if (kind === 'singleType') {
        return (0, _fetch.fetchEntity)(config, ctx);
      }

      return (0, _fetch.fetchEntities)(config, ctx);
    }));
  }

  const data = newOrExistingEntries || allResults; // Build a map of all nodes with the gatsby id and the strapi_id

  const existingNodesMap = (0, _helpers.buildMapFromNodes)(existingNodes); // Build a map of all the parent nodes that should be removed
  // This should also delete all the created nodes for markdown, relations, dz...
  // When fetching only one content type and populating its relations it might cause some issues
  // as the relation nodes will never be deleted
  // it's best to fetch the content type and its relations separately and to populate
  // only one level of relation

  const nodesToRemoveMap = (0, _helpers.buildNodesToRemoveMap)(existingNodesMap, endpoints, allResults); // Delete all nodes that should be deleted

  Object.entries(nodesToRemoveMap).forEach(([nodeName, nodesToDelete]) => {
    if (nodesToDelete.length) {
      reporter.info(`Strapi: ${nodeName} deleting ${nodesToDelete.length}`);
      nodesToDelete.forEach(({
        id
      }) => {
        const node = getNode(id);
        touchNode(node);
        deleteNode(node);
      });
    }
  });
  let warnOnceForNoSupport = false;
  await cache.set(LAST_FETCHED_KEY, Date.now());

  for (let i = 0; i < endpoints.length; i++) {
    const {
      uid
    } = endpoints[i];
    await (0, _downloadMediaFiles.downloadMediaFiles)(data[i], ctx, uid);

    for (let entity of data[i]) {
      const nodes = (0, _normalize.createNodes)(entity, ctx, uid);
      await Promise.all(nodes.map(n => actions.createNode(n)));
      const nodeType = (0, _helpers.makeParentNodeName)(ctx.schemas, uid);
      const mainEntryNode = nodes.find(n => {
        return n && n.strapi_id === entity.id && n.internal.type === nodeType;
      });
      const isPreview = process.env.GATSBY_IS_PREVIEW === `true`;
      const createNodeManifestIsSupported = typeof unstable_createNodeManifest === `function`;
      const shouldCreateNodeManifest = isPreview && createNodeManifestIsSupported && mainEntryNode;

      if (shouldCreateNodeManifest) {
        const updatedAt = entity.updatedAt;
        const manifestId = `${uid}-${entity.id}-${updatedAt}`;
        actions.unstable_createNodeManifest({
          manifestId,
          node: mainEntryNode,
          updatedAtUTC: updatedAt
        });
      } else if (isPreview && !createNodeManifestIsSupported && !warnOnceForNoSupport) {
        console.warn(`gatsby-source-strapi: Your version of Gatsby core doesn't support Content Sync (via the unstable_createNodeManifest action). Please upgrade to the latest version to use Content Sync in your site.`);
        warnOnceForNoSupport = true;
      }
    }
  }

  return;
};