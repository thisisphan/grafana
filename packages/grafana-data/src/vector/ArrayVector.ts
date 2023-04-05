import { MutableVector } from '../types/vector';

/**
 * @public
 */
export class ArrayVector<T = any> extends Array<T> implements MutableVector<T> {
  constructor(buffer?: T[]) {
    super();
    if (buffer?.length) {
      this.push(...buffer);
    }
  }

  // /** @deprecated -- not necessary anymore */
  // get buffer() {
  //   return this;
  // }

  // /** @deprecated -- not necessary anymore */
  // set buffer(v: T[]) {
  //   this.length = 0;
  //   this.push(...v);
  // }

  add(value: T) {
    this.push(value);
  }

  get(index: number): T {
    return this[index];
  }

  set(index: number, value: T) {
    this[index] = value;
  }

  toArray(): T[] {
    return this;
  }

  toJSON(): T[] {
    return this;
  }
}
