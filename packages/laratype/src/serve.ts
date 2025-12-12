import { Hono } from "hono"
import { register } from "./bootstrap";

export default class Serve {
  
  private static instance: Hono|null = null

  protected static port: number = 3000;

  protected static host: string = 'localhost';

  public static getInstance() {
    if(!this.instance) this.instance = new Hono();
    return this.instance
  }

  public static async bootProvider() {
    const cleanup = [];
    const instance = this.getInstance()
    const serviceProviderBootstrapped = await register()
    for(let Provider of serviceProviderBootstrapped) {
      const provider = new Provider(instance);
      const handler = provider.boot()
      if(handler instanceof Promise) {
        await handler;
      }
      cleanup.push(provider.down.bind(provider));
    }
    return cleanup;
  }

  public static down() {
    this.instance = null;
  }
}
