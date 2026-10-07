import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { HostCharacter, LiveScript, LiveSession, Product, Promotion, Scene, ViewerQuestion } from "@tlai/shared";
import { seedCharacters, seedProducts, seedPromotions, seedScenes, seedScripts } from "./seed.js";

export interface Db {
  products: Product[];
  promotions: Promotion[];
  scenes: Scene[];
  characters: HostCharacter[];
  scripts: LiveScript[];
  sessions: LiveSession[];
  questions: ViewerQuestion[];
}

export type Collection = keyof Db;

const seed = (): Db => ({
  products: structuredClone(seedProducts),
  promotions: structuredClone(seedPromotions),
  scenes: structuredClone(seedScenes),
  characters: structuredClone(seedCharacters),
  scripts: structuredClone(seedScripts),
  sessions: [],
  questions: [],
});

/** Local JSON store. A desktop app for one seller does not need a database server. */
export class Store {
  readonly db: Db;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string | null) {
    if (file && existsSync(file)) {
      this.db = { ...seed(), ...(JSON.parse(readFileSync(file, "utf8")) as Partial<Db>) };
    } else {
      this.db = seed();
      this.flush();
    }
  }

  list<K extends Collection>(k: K): Db[K] {
    return this.db[k];
  }

  get<K extends Collection>(k: K, id: string): Db[K][number] | undefined {
    return (this.db[k] as { id: string }[]).find((x) => x.id === id) as Db[K][number] | undefined;
  }

  insert<K extends Collection>(k: K, item: Db[K][number]): Db[K][number] {
    (this.db[k] as Db[K][number][]).push(item);
    this.save();
    return item;
  }

  update<K extends Collection>(k: K, id: string, patch: Partial<Db[K][number]>): Db[K][number] | undefined {
    const item = this.get(k, id);
    if (!item) return undefined;
    Object.assign(item as object, patch);
    this.save();
    return item;
  }

  remove(k: Collection, id: string): boolean {
    const arr = this.db[k] as { id: string }[];
    const i = arr.findIndex((x) => x.id === id);
    if (i < 0) return false;
    arr.splice(i, 1);
    this.save();
    return true;
  }

  /** Debounced write so a busy live session does not hammer the disk. */
  save(): void {
    if (!this.file) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }

  flush(): void {
    if (!this.file) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    renameSync(tmp, this.file);
  }
}
