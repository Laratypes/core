import { Config, resolveSync, getLaratypeVersion, getRootPackageInfo, type Hono, importModule, resolveModule, getAppPath } from "@laratype/support";
import { type InlineConfig, type ViteDevServer } from "vite";
import { Command, Console } from "@laratype/console";
import { green, blue } from "kolorist";
import path from "path";
import { IncomingMessage, ServerResponse } from "http";
import { getRequestListener } from "@hono/node-server";
import Transpile from "../utils/transplie";
import { Runner } from "../utils/runner/Runner";

export default class LaratypeDevCommand extends Command {

  static signature = 'dev'

  static description = 'Start the development server'

  static options = [
    ['-p, --port <port>', 'Port to run the server on', '3000'],
    ['-H, --host <host>', 'Host to run the server on', 'localhost'],
    ['--hmr', 'Enable Hot Module Replacement'],
  ]

  // Disable all providers by default
  public async providers() {
    return [];
  }

  protected runner: Runner | undefined;

  protected serverInstance: {
    app: Hono,
    down: () => void,
  } | undefined;

  public async boot(transpiler: Transpile) {
    Console.start('Starting Laratype application...');

    const opts = this.opts();
    
    await transpiler.close();
    const oldConfig = transpiler.getConfig();
    const devServerConfig: InlineConfig = {
      server: {
        port: opts.port,
        host: opts.host,
        hmr: false,
      },
      plugins: [
        {
          name: 'laratype:dev-server',
          configureServer: async (server) => {
            this.serverInstance = await this.appStart(server);

            if(opts.hmr) {
              server.watcher.on('change', (async () => {
                Console.info('File change detected. Restarting server...');
                await this.serverInstance!.down();
                this.serverInstance = await this.appStart(server);
              }));
            }

            server.middlewares.use(await this.createMiddleware(server));
          }
        },
      ]
    };

    const { mergeConfig } = await import(resolveModule("vite", {
      url: import.meta.url,
    })) as typeof import("vite");

    const newConfig = mergeConfig(oldConfig, devServerConfig);
    transpiler.setConfig(newConfig);

    await transpiler.init();

    this.runner = await transpiler.getRunner();

    await this.runner.ready();
    
  }

  protected async appStart(vite: ViteDevServer): Promise<{ app: Hono, down: () => void }> {
    globalThis.__sauf_transpiler_instance = vite.ssrLoadModule.bind(this.runner);    

    const { Serve } = await vite.ssrLoadModule(resolveModule("laratype", {
      internal: true,
    })) as typeof import("laratype");

    const cleanupFns = await Serve.bootProvider();

    const cleanup = async () => {
      for (const cleanupFn of cleanupFns) {
        await cleanupFn();
      }
    }

    const down = async () => {
      await cleanup()
      Serve.down();
    }

    return {
      app: Serve.getInstance(),
      down,
    }

  }

  protected async requestHandler({ app, server, req, res }: any) {
    //  app.use((context: unknown, next: any) => {
    //   // if (err instanceof Error)
    //   //   server.ssrFixStacktrace(err);

    //   next(context);
    // });

    const requestListener = getRequestListener(app.fetch);

    requestListener(req, res);

  }

  protected async createMiddleware(server: ViteDevServer) {

    return async (
      req: IncomingMessage,
      res: ServerResponse,
      next: (err?: any) => void
    ) => {
      await this.requestHandler({ app: this.serverInstance!.app, server, req, res, next });
    }
  }

  public async handle() {

    const opts = this.opts();
    const startTime = globalThis.__sauf_start_time || performance.now();

    const runner = this.runner!;

    await runner.listen();

    const endTime = performance.now();

    const version = await getLaratypeVersion();
    const rootInfo = await getRootPackageInfo();
    
    let envFileName = '';

    if (globalThis.__laratype_env_file) {
      envFileName = path.basename(globalThis.__laratype_env_file);
    }
    else {
      Console.warn('No .env file found');
    }

    const messages = [
      green(`Laratype v${version} dev server run on:`),
      '',
      green(`Address: ${blue(`http://${opts.host}:${opts.port}`)}`),
      green(`Environment: ${blue(Config.get(['env']))}`),
      green(`Env file: ${blue(envFileName)}`),
      green(`HMR: ${blue(opts.hmr ? "True" : "False")}`),
      '',
      green(`Ready in ${blue(`${(endTime - startTime).toFixed(2)}ms`)}`),
    ]

    Console.box({
      title: `${rootInfo.name ?? ''} ${rootInfo.version ?? ''}`,
      message: messages.join('\n'),
      style: {
      padding: 2,
        borderColor: "cyan",
      },
    });

    await new Promise(() => {}); // Keep the server running
  }
}