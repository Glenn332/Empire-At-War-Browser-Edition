import { db } from '../gamedata.js';
import { loadTextureCanvas } from '../dds.js';
import { onLanguageChange } from '../language.js';
import { menuOverlayFile } from '../localizedmedia.js';

export class MenuArtwork {
  constructor(root, { constants = () => db.constants, load = loadTextureCanvas } = {}) {
    this.root = root;
    this.constants = constants;
    this.load = load;
    this.cache = new Map();
    this.generation = 0;
    this.disposed = false;
    this.unsubscribe = onLanguageChange(() => this.refresh(), 2);
  }
  async refresh() {
    if (this.disposed) return;
    const file = menuOverlayFile(this.constants());
    if (this.file === file && this.pending) return this.pending;
    this.file = file;
    const generation = ++this.generation;
    if (!this.cache.has(file))
      this.cache.set(
        file,
        Promise.resolve()
          .then(() => this.load(file))
          .then(canvas => canvas?.toDataURL() || '')
          .catch(() => '')
      );
    this.pending = this.cache.get(file).then(url => {
      if (this.disposed || generation !== this.generation) return;
      this.root.style.backgroundImage = url ? `url(${JSON.stringify(url)})` : '';
      this.root.dataset.texture = file;
    });
    return this.pending;
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.unsubscribe();
    this.cache.clear();
  }
}
