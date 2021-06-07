'use strict';
const fs = require('fs');
const async_hooks = require('async_hooks');
const AWS = require('aws-sdk');

try {
    Object.assign(process.env, Object.assign(JSON.parse(fs.readFileSync('/var/secrets/secrets.json', 'utf8')), process.env));
} catch (err) {
    if (err.code != 'ENOENT') throw err;
}

global.__DEV__ = process.env.NODE_ENV == 'development';
global.log = require('pino')({
    level: String(process.env.LOG_LEVEL || 'warn').toLowerCase(),
    formatters: {level: (level) => ({level: level.toUpperCase()})},
    prettyPrint: global.__DEV__,
    hooks: {
        logMethod(args, method) {
            Object.assign(args[0], {requestId: global.currentContext.requestId, cronTask: global.currentContext.cronTask});
            return method.apply(this, args);
        },
    },
});

if (process.env.S3_ENDPOINT) AWS.config.update({endpoint: new AWS.Endpoint(process.env.S3_ENDPOINT), s3ForcePathStyle: true, signatureVersion: 'v4'});

const contexts = {};

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
