addon = window.addon || {port: {on: () => null, emit: () => null}};

let generic = Function.call.bind(Function.bind, Function.call);
let map = generic(Array.prototype.map)
let forEach = generic(Array.prototype.forEach);

let MatchesSelector = generic(
  Element.prototype.matchesSelector ||
  Element.prototype.mozMatchesSelector ||
  Element.prototype.webkitMatchesSelector);

function closest (node, selector) {

  while (node.nodeType === 1 && !MatchesSelector(node, selector))
    node = node.parentNode;

  return node.nodeType === 1 ? node : null;
};

let DOM = {
  createProject: definition => {
    let webpage = document.querySelector('#webpage');

    webpage.style.backgroundImage = 'url(' + definition.image + ')';
    webpage.className = 'has-icon';

    document.getElementById('txt-name').value = definition.name;
    document.getElementById('txt-author').value = definition.author;
    document.getElementById('txt-description').value = definition.description;

    if (definition.mods)
      definition.mods.forEach(addListItem);
  },

  addListItem: (item='') => {
    let template = document.getElementById('list-template');

    let node = template.parentNode.insertBefore(template.cloneNode(true), template);

    node.querySelector('h4').textContent = item.url || '';
    node.querySelector('input').value = item.description || '';

    node.id = "";
    node.dataset.changes = item.changes || '';

    document.getElementById('addon-export').disabled = false;
  }
}

let ThemeMySite = {
  init: function() {
    addon.port.on('init', DOM.createProject);
    addon.port.on('add-modification', DOM.addListItem);

    let ul = document.querySelector('#list ul');

    document.body.addEventListener('click', event => {
      if (closest(event.target, 'button.confirm'))
        return;

      forEach(document.querySelectorAll('button.confirm'),
        button => button.className = '');
    });

    ul.addEventListener('click', event => {
      let button = closest(event.target, 'button');
      if (button.className === 'confirm') {
        let li = closest(button, 'li');

        if (li.parentNode.children.length === 2)
          document.getElementById('addon-export').disabled = true;

        li.remove();
      } else {
        button.className = 'confirm';
      }
    });

    document.getElementById('addon-export').addEventListener('click',
      this.save);
    document.getElementById('btn-add-css').addEventListener('click',
      this.startRecording);
  },

  startRecording: function() {
    this.removeEventListener('click', ThemeMySite.startRecording);
    this.addEventListener('click', ThemeMySite.stopRecording);

    this.className = 'recording';

    addon.port.emit('start-recording');
  },

  stopRecording: function() {
    this.removeEventListener('click', ThemeMySite.stopRecording);
    this.addEventListener('click', ThemeMySite.startRecording);

    this.className = '';

    DOM.addListItem();

    addon.port.emit('stop-recording');
  },

  save: function() {
    let mods = map(document.querySelectorAll('#list li:not(#list-template)'), node => {
      return {
        url: node.querySelector('h4').textContent,
        description: node.querySelector('input').value,
        changes: node.dataset.changes
      }
    });
    addon.port.emit('export', {
      name: document.getElementById('txt-name').value,
      description: document.getElementById('txt-description').value,
      author: document.getElementById('txt-author').value,
      mods: mods
    });
  },

  handleEvent: function(event) {
    switch (event.type) {
      case 'DOMContentLoaded':
        this.init();
        break;
    }
  }
}

window.addEventListener('DOMContentLoaded', ThemeMySite);
