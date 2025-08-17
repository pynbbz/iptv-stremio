const express = require('express');
const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const NodeCache = require('node-cache');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');

// Constants
const IPTV_CHANNELS_URL = 'https://iptv-org.github.io/api/channels.json';
const IPTV_STREAMS_URL = 'https://iptv-org.github.io/api/streams.json';
const FETCH_INTERVAL = parseInt(process.env.FETCH_INTERVAL) || 86400000; // default 1 day
const PROXY_URL = process.env.PROXY_URL || '';
const FETCH_TIMEOUT = parseInt(process.env.FETCH_TIMEOUT) || 10000; // default 10 seconds

// Configuration for channel filtering
const config = {
    includeLanguages: process.env.INCLUDE_LANGUAGES ? process.env.INCLUDE_LANGUAGES.split(',') : [],
    includeCountries: process.env.INCLUDE_COUNTRIES ? process.env.INCLUDE_COUNTRIES.split(',') : ['GR'],
    excludeLanguages: process.env.EXCLUDE_LANGUAGES ? process.env.EXCLUDE_LANGUAGES.split(',') : [],
    excludeCountries: process.env.EXCLUDE_COUNTRIES ? process.env.EXCLUDE_COUNTRIES.split(',') : [],
    excludeCategories: process.env.EXCLUDE_CATEGORIES ? process.env.EXCLUDE_CATEGORIES.split(',') : [],
};

// Express app setup
const app = express();
app.use(express.json());

// Cache setup
const cache = new NodeCache({ stdTTL: 0 }); // infinite TTL

// Addon Manifest
const manifest = {
    id: 'org.iptv',
    name: 'IPTV Addon',
    version: '0.0.2',
    description: `Watch live TV from ${config.includeCountries.join(', ')}`,
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'],
    catalogs: config.includeCountries.map(country => ({
        type: 'tv',
        id: `iptv-channels-${country}`,
        name: `IPTV - ${country}`,
        extra: [
            {
                name: 'genre',
                isRequired: false,
                options: [
                    "animation","business","classic","comedy","cooking","culture","documentary","education","entertainment",
                    "family","kids","legislative","lifestyle","movies","music","general","religious","news","outdoor",
                    "relax","series","science","shop","sports","travel","weather","xxx","auto"
                ]
            }
        ],
    })),
    idPrefixes: ['iptv-'],
    behaviorHints: { configurable: false, configurationRequired: false },
    logo: "https://dl.strem.io/addon-logo.png",
    icon: "https://dl.strem.io/addon-logo.png",
    background: "https://dl.strem.io/addon-background.jpg",
};

const addon = new addonBuilder(manifest);

// --- Helper Functions ---
const toMeta = (channel) => ({
    id: `iptv-${channel.id}`,
    name: channel.name,
    type: 'tv',
    genres: [...(channel.categories || []), channel.country].filter(Boolean),
    poster: channel.logo,
    posterShape: 'square',
    background: channel.logo || null,
    logo: channel.logo || null,
});

const getChannels = async () => {
    try {
        const channelsResponse = await axios.get(IPTV_CHANNELS_URL, { timeout: FETCH_TIMEOUT });
        return channelsResponse.data;
    } catch (error) {
        if (cache.has('channels')) return cache.get('channels');
        return null;
    }
};

const getStreamInfo = async () => {
    if (!cache.has('streams')) {
        try {
            const streamsResponse = await axios.get(IPTV_STREAMS_URL, { timeout: FETCH_TIMEOUT });
            cache.set('streams', streamsResponse.data);
        } catch {
            return [];
        }
    }
    return cache.get('streams');
};

const verifyStreamURL = async (url, userAgent, httpReferrer) => {
    const cachedResult = cache.get(url);
    if (cachedResult !== undefined) return cachedResult;

    const effectiveUserAgent = userAgent || 'Mozilla/5.0';
    const effectiveReferer = httpReferrer || '';

    let axiosConfig = {
        timeout: FETCH_TIMEOUT,
        headers: { 'User-Agent': effectiveUserAgent, 'Accept': '*/*', 'Referer': effectiveReferer }
    };

    if (PROXY_URL) {
        if (PROXY_URL.startsWith('socks')) axiosConfig.httpsAgent = new SocksProxyAgent(PROXY_URL);
        else axiosConfig.httpsAgent = new HttpProxyAgent(PROXY_URL);
    }

    try {
        const response = await axios.head(url, axiosConfig);
        const result = response.status === 200;
        cache.set(url, result);
        return result;
    } catch {
        cache.set(url, false);
        return false;
    }
};

const getAllInfo = async () => {
    if (cache.has('channelsInfo')) return cache.get('channelsInfo');

    const streams = await getStreamInfo();
    const channels = await getChannels();
    if (!channels) return cache.get('channelsInfo') || [];

    const streamMap = new Map(streams.map(stream => [stream.channel, stream]));

    const filteredChannels = channels.filter((channel) => {
        if (config.includeCountries.length > 0 && !config.includeCountries.includes(channel.country)) return false;
        if (config.excludeCountries.length > 0 && config.excludeCountries.includes(channel.country)) return false;
        if (config.includeLanguages.length > 0 && !channel.languages.some(lang => config.includeLanguages.includes(lang))) return false;
        if (config.excludeLanguages.length > 0 && channel.languages.some(lang => config.excludeLanguages.includes(lang))) return false;
        if (config.excludeCategories.some(cat => channel.categories.includes(cat))) return false;
        return streamMap.has(channel.id);
    });

    const channelsWithDetails = await Promise.all(filteredChannels.map(async (channel) => {
        const streamInfo = streamMap.get(channel.id);
        if (streamInfo && await verifyStreamURL(streamInfo.url, streamInfo.user_agent, streamInfo.http_referrer)) {
            const meta = toMeta(channel);
            meta.streamInfo = {
                url: streamInfo.url,
                title: 'Live Stream',
                httpReferrer: streamInfo.http_referrer
            };
            return meta;
        }
        return null;
    }));

    const filteredChannelsInfo = channelsWithDetails.filter(Boolean);
    cache.set('channelsInfo', filteredChannelsInfo);
    return filteredChannelsInfo;
};

// --- Addon Handlers ---
addon.defineCatalogHandler(async ({ type, id, extra }) => {
    if (type === 'tv' && id.startsWith('iptv-channels-')) {
        const country = id.split('-')[2];
        const allChannels = await getAllInfo();
        let filteredChannels = allChannels.filter(channel => channel.genres.includes(country));

        if (extra && extra.genre) {
            const genres = Array.isArray(extra.genre) ? extra.genre : [extra.genre];
            filteredChannels = filteredChannels.filter(channel =>
                genres.some(genre => channel.genres.includes(genre))
            );
        }
        return { metas: filteredChannels };
    }
    return { metas: [] };
});

addon.defineMetaHandler(async ({ type, id }) => {
    if (type === 'tv' && id.startsWith('iptv-')) {
        const channels = await getAllInfo();
        const channel = channels.find((meta) => meta.id === id);
        if (channel) return { meta: channel };
    }
    return { meta: {} };
});

addon.defineStreamHandler(async ({ type, id }) => {
    if (type === 'tv' && id.startsWith('iptv-')) {
        const channels = await getAllInfo();
        const channel = channels.find((meta) => meta.id === id);
        if (channel?.streamInfo) {
            return { streams: [channel.streamInfo] };
        }
    }
    return { streams: [] };
});

// Initial background fetch
(async () => {
    try {
        const metas = await getAllInfo();
        console.log(`${metas.length} channel(s) cached`);
    } catch (e) {
        console.error("Error caching channels:", e);
    }
})();
setInterval(getAllInfo, FETCH_INTERVAL);

// --- Export for Vercel ---
module.exports = { addon, manifest, app };
