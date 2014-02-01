/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
'use strict';

module.metadata = {
  'stability': 'experimental'
};

const { id: addonId, data } = require('sdk/self');
const { register } = require('./tools');
const { window } = require('sdk/addon/window');
const { getTabContentWindow, getActiveTab } = require('sdk/tabs/utils');
const { getMostRecentBrowserWindow } = require('sdk/window/utils');
const { defer } = require('sdk/core/promise');
const { getFavicon } = require('sdk/places/favicon');
const { ZipReader, ZipWriter } = require('./zip');
const { toFilename } = require('sdk/url');
const tmpDir = require("sdk/system").pathFor("TmpD");
const fs = require('sdk/io/file');
const { Cc, Ci } = require('chrome');

function MozFile(path) {
  let file = Cc['@mozilla.org/file/local;1']
               .createInstance(Ci.nsILocalFile);
  file.initWithPath(path);

  return file;
}

function getCanvas() {
  let { document } = window;
  let id = addonId + '-canvas';
  let canvas = document.getElementById(id);

  if (!canvas) {
    canvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
    document.documentElement.appendChild(canvas);
    canvas.id = id;

    canvas.width = 128;
    canvas.height = 128;
  }

  return canvas;
}

function getContentWindow()
  getTabContentWindow(getActiveTab(getMostRecentBrowserWindow()));

function getSiteInfo() {
  let win = getContentWindow();

  return {
    title: win.document.title,
    domain: win.location.host,
    url: win.location.href
  }
}

function getSiteThumbnail() {
  let win = getContentWindow();

  let width = win.innerWidth;
  let height = 2000; //win.document.documentElement.offsetHeight;

  let canvas = getCanvas();
  canvas.width = canvas.width;
  let context = canvas.getContext('2d');

  let snippetWidth = 128;
  let scale = snippetWidth / win.innerWidth;
  context.save();
  context.scale(scale, scale);

  context.fillRect(0, 0, canvas.width, canvas.height, 'transparent')

  context.drawWindow(win, win.scrollX, win.scrollY, width, height, 'white');

  let { promise, resolve, reject } = defer();

  getFavicon(win.location.href).then(url => {
    let img = new win.Image();
    img.onerror = reject;
    img.onload = () => {
      context.restore();
      context.drawImage(img, 0, 0);
      resolve(canvas.toDataURL());
    }
    img.src = url;
  });

  return promise;
}

let cssRules = ({document}) => Array.slice(document.styleSheets).reduce(
    (rules, styleSheet) => rules.concat(Array.slice(styleSheet.cssRules))
, []);

let map = rules => rules.reduce((object, rule) =>
  (object[rule.cssText] = rule, object), {});

let startRules = null;

function startRecording() {
  let win = getContentWindow();

  startRules = map(cssRules(win));
}

function stopRecording() {
  let style = getStyle();

  this.emit('add-modification', {
    url: getContentWindow().location.href,
    changes: style
  });
}

function getStyle() {
  let win = getContentWindow();

  let endRules = map(cssRules(win));

  return Object.keys(endRules).reduce( (newRules, cssText) => {
    if (!(cssText in startRules)) {
      let { selectorText } = endRules[cssText];

      let properties = cssText.substr(selectorText.length).replace(/^\s*\{\s*|\s*\}\s*$/g,'').split(/\s*;\s*/)

      let text = properties.filter(prop => prop.indexOf('url(') === -1).join(';')

      newRules.push(selectorText + '{' + text + '}');
    }

    return newRules;
  }, []).join('\n');
}

function createPageMod(definition) {
  let { mods } = definition;

  let styleString = mods.map(mod => mod.changes).join('\n');

  let templateURL = data.url('theme-my-site-template.xpi');
  let template = toFilename(templateURL);
  let templateFile = MozFile(template);
  let addonFile = MozFile(tmpDir);
  let url = getContentWindow().location;

  if (definition.appliedToDomain) {
    url = url.origin + '/*';
  } else {
    url = url.href;
  }

  templateFile.copyTo(addonFile, '');
  addonFile.append(templateFile.leafName);

  let reader = new ZipReader(addonFile.path);
  let writer = new ZipWriter(addonFile.path);

  let installRdf = reader.read('install\.rdf');
  let mainJs = reader.read('resources/theme-my-site-template/lib/main.js');

  mainJs = mainJs.replace(/'\*'/, "'" + url + "'");

  installRdf = installRdf.replace(/theme-my-site-template/, definition.name)
                  .replace(/a basic add-on/, definition.description)
                  .replace(/<em:creator><\/em:creator>/, '<em:creator>' +  definition.author + '</em:creator>');

  //console.log(reader.ls().join('\n'))
  reader.close();

  let input = Cc["@mozilla.org/io/string-input-stream;1"].
                  createInstance(Ci.nsIStringInputStream);

  input.setData(installRdf, installRdf.length);

  writer.remove('install.rdf');
  writer.addStream('install.rdf', input);

  let input = Cc["@mozilla.org/io/string-input-stream;1"].
                  createInstance(Ci.nsIStringInputStream);

  input.setData(styleString, styleString.length);

  writer.remove('resources/theme-my-site-template/data/style.css');
  writer.addStream('resources/theme-my-site-template/data/style.css', input);

  let input = Cc["@mozilla.org/io/string-input-stream;1"].
                  createInstance(Ci.nsIStringInputStream);

  input.setData(mainJs, mainJs.length);

  writer.remove('resources/theme-my-site-template/lib/main.js');
  writer.addStream('resources/theme-my-site-template/lib/main.js', input);

  writer.close();

  let nsIFilePicker = Ci.nsIFilePicker;
  let fp = Cc["@mozilla.org/filepicker;1"].
          createInstance(nsIFilePicker);

  fp.init(getMostRecentBrowserWindow(), "Save", Ci.nsIFilePicker.modeSave);
  let rv = fp.show();

  if (rv == nsIFilePicker.returnOK || rv == nsIFilePicker.returnReplace) {
    let file = fp.file;

    addonFile.moveTo(file.parent, file.leafName);
  }
}

register({
    id: 'theme-my-site',
    label: 'Theme My Site',
    tooltip: 'Theme My Site',
    key: 'T',
    url: './index.html',
    onAttach: ({port}) => {
      port.on('start-recording', startRecording);
      port.on('stop-recording', stopRecording);
      port.on('export', createPageMod);

      getSiteThumbnail().then(image => {
        let info = getSiteInfo();

        port.emit('init', {
          label: info.domain,
          image: image,
          name: info.domain,
          description: 'Mod for ' + info.title,
          author: '',
          url: info.url
        });
      })
    }
});
