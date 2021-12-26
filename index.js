'use strict';
require('axios/lib/core/createError');
const fs = require('fs');
const async_hooks = require('async_hooks');

try {
    Object.assign(process.env, Object.assign(JSON.parse(fs.readFileSync('/var/secrets/secrets.json', 'utf8')), process.env));
} catch (err) {
    if (err.code != 'ENOENT') throw err;
}

global.__DEV__ = process.env.NODE_ENV == 'development';
global.log = require('pino')({
    level: String(process.env.LOG_LEVEL || 'warn').toLowerCase(),
    formatters: {level: (level) => ({level: level.toUpperCase()})},
    mixin: () => ({
        requestId: global.asyncContext?.requestId || global.currentContext?.requestId,
        cronTask: global.asyncContext?.cronTask || global.currentContext?.cronTask,
    }),
    base: undefined,
    ...(global.__DEV__
        ? {
              transport: {
                  target: 'pino-pretty',
              },
          }
        : {}),
});

if (process.env.S3_ENDPOINT) {
    const AWS = require('aws-sdk');
    AWS.config.update({endpoint: new AWS.Endpoint(process.env.S3_ENDPOINT), s3ForcePathStyle: true, signatureVersion: 'v4'});
}

const contexts = {};
const context = new async_hooks.AsyncLocalStorage();

async_hooks
    .createHook({
        init: (asyncId, type, triggerAsyncId) => contexts[triggerAsyncId] && (contexts[asyncId] = contexts[triggerAsyncId]),
        destroy: (asyncId) => delete contexts[asyncId],
    })
    .enable();

Object.defineProperty(global, 'currentContext', {
    get() {
        const asyncId = async_hooks.executionAsyncId();
        return contexts[asyncId] || (contexts[asyncId] = {});
    },
});

Object.defineProperty(global, 'asyncContext', {
    get() {
        return context.getStore() || context.run.bind(context);
    },
});

global.Sentry = require('@sentry/node');

process.on('uncaughtException', (err, origin) => {
    err.origin = origin;
    Sentry.captureException(err);
    log.fatal(err);
});

for (const m of module.children) {
    if (!m.filename.endsWith('node_modules/axios/lib/core/createError.js')) continue;
    const enhanceError = require('axios/lib/core/enhanceError');
    m.exports = function createError(message, config, code, request, response) {
        const error = enhanceError(new Error(message), config, code, request, response);
        Error.captureStackTrace(error, createError);
        return error;
    };
    break;
}

module.exports = {context};
