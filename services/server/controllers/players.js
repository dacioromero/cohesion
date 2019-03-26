const express = require('express');
const asyncHandler = require('express-async-handler');

const zipObject = require('lodash/zipObject');
const isEmpty = require('lodash/isEmpty');
const merge = require('lodash/merge');
const mapValues = require('lodash/mapValues');

const cache = require('../utils/redis');

const router = express.Router();
const Steam = require('../utils/steam');

// Force Redis to store false for null and convert back; null is expected for no response
const convertFalsy = forced => v => v || forced;
const convFalsyNull = convertFalsy(null); // Convert cache to wrapper
const convFalsyFalse = convertFalsy(false); // Wrapper to cache

const getLibraries = async (ids) => {
  // Get cached values
  const cachedLibs = zipObject(
    ids,
    (await cache.mgetAsync(...ids.map(id => `/libraries/${id}`)))
      .map(JSON.parse)
      .map(convFalsyNull),
  );

  // Get from wrapper new for all missing
  const newLibs = Object.assign(
    {},
    ...(await Promise.all(Object.entries(cachedLibs)
      .filter(([, games]) => games === null)
      .map(async ([id]) => {
        const games = await Steam.GetOwnedGames(id);
        return { [id]: games };
      }))),
  );

  // Store missing values
  if (!isEmpty(newLibs)) {
    await cache.msetAsync(
      ...Object.entries(newLibs)
        .map(([id, games]) => [`/libraries/${id}`, JSON.stringify(convFalsyFalse(games))])
        .flat(),
    );
  }

  return { ...cachedLibs, ...newLibs };
};

const getProfiles = async (ids) => {
  // Get cached values
  const cachedProfs = zipObject(
    ids,
    (await cache.mgetAsync(...ids.map(id => `/profiles/${id}`)))
      .map(JSON.parse)
      .map(convFalsyNull),
  );

  // Get from wrapper new for all missing
  const newProfs = await Steam.GetPlayerSummaries(
    ...Object.entries(cachedProfs)
      .filter(([, profile]) => profile === null)
      .map(([id]) => id),
  );

  // Store missing values
  if (!isEmpty(newProfs)) {
    await cache.msetAsync(
      ...Object.entries(newProfs)
        .map(([id, profile]) => [`/profiles/${id}`, JSON.stringify(convFalsyFalse(profile))])
        .flat(),
    );
  }

  return { ...cachedProfs, ...newProfs };
};

router.get('/', asyncHandler(async (req, res) => {
  let { steamIds: ids } = req.query;

  if (typeof ids === 'string' || ids instanceof String) {
    ids = ids.split(',');
  }

  // Convert URLs, IDs, and vanity names
  ids = (await Promise.all(ids.map(id => Steam.GetSteamId64(id)))).filter(Boolean);

  const [libraries, profiles] = await Promise.all([
    getLibraries(ids),
    getProfiles(ids),
  ]);

  merge(profiles, mapValues(libraries, games => ({ games })));

  res.json(profiles);
}));

module.exports = router;
