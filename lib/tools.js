/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
'use strict';

module.metadata = {
  'stability': 'experimental'
};

const { Cu } = require('chrome');
const { id, data } = require('sdk/self');
const { when: unload } = require('sdk/system/unload');
const { gDevTools } = Cu.import('resource:///modules/devtools/gDevTools.jsm', {});
const { merge } = require('sdk/util/object');
const events = require('sdk/system/events');
const { Worker } = require('sdk/content/worker');
const runtime = require('sdk/system/runtime');

const url = _ => _.startsWith('./') ? data.url(_.substr(2)) : _ ;

const tools = new Map();

function onContent({subject: document}) {
  let window = document.defaultView;

  if (window && window.frameElement) {
    let id = window.frameElement.id.replace(/^toolbox-panel-iframe-/, '');

    if (tools.has(id)) {
      let tool = tools.get(id);
      let { onAttach } = tool.definition;

      if (typeof onAttach === 'function') {
        let worker = Worker({
          window: window,
          injectInDocument: true
        });

        worker.on('detach', () => worker.destroy());

        onAttach.call(tool, worker);
        tool.worker = worker;
      }
    }
  }
}

events.on('document-element-inserted', onContent, true);
unload(() => events.off('document-element-inserted', onContent, true));

function register(tool) {
  let definition = {
    id: tool.id,
    icon: tool.icon ? url(tool.icon) : undefined,
    url: tool.url ? url(tool.url) : 'about:blank',
    label: tool.label,
    tooltip: tool.tooltip,
    ordinal: tool.ordinal || 0,
    inMenu: true,
    key: tool.key,
    modifiers: runtime.OS == "Darwin" ? "accel,alt" : "accel,shift",
    isTargetSupported: tool.isTargetSupported || (target => {
      return target.isLocalTab //&& /^https?/.test(target.url)
    }),
    build: function(window, toolbox) {
      let tool = tools.get(this.id);

      if (tool) {
        tool.window = window;
        tool.toolbox = toolbox;
      }
    },
    onAttach: tool.onAttach
  };

  tools.set(definition.id, {
    definition: definition,
    window: null,
    toolbox: null,
    worker: null
  });

  gDevTools.registerTool(definition);

  unload(() => {
    unregister(definition);
    tools.delete(definition.id);
  });
}
exports.register = register;

function unregister(definition) {
  gDevTools.unregisterTool(definition);
}
exports.unregister = unregister;
