// export type UserMessage = {
//     Owner: string;
//     Target: string;
//     Tags: Tag[];
//     Data?: string | number;
//     From: string;
//     "Block-Height": string;
//     Timestamp: string;
//     Cron: boolean;
// };

import { AOS_MODULE } from "./config.js";
import { getModuleSync } from "./module.js";

// export type  ProcessEnv = {
//     Id: string;
//     Owner: string;
//     Tags: Tag[];
// }

import AoLoader from "@permaweb/ao-loader";

export class Process {
  constructor(module, code, env) {
    this.height = 0;
    this.module = !module
      ? AOS_MODULE
      : module === "sqlite"
      ? AOS_SQLITE_MODULE
      : module;
    this.code = code;
    this.env = {
      process_id: "4567",
      owner: "FOOBAR",
      from: "FOOBAR",
      ...env,
    };
    this.memory = null;
    this.handle = null;
    this.result = null;
  }

  static async create(module, code, env) {
    const process = new Process(module, code, env);
    await process.initialize();
    return process;
  }

  async initialize() {
    console.log("Initializing process", this.env.process_id);
    const wasmBinary = await getModuleSync(this.module);
    // 异步初始化逻辑，例如加载AoLoader
    this.handle = await AoLoader(wasmBinary, {
      format: "wasm64-unknown-emscripten-draft_2024_02_15",
    });
    const result = await this.handle(
      null,
      this.createMsg(this.code),
      this.createEnv()
    );
    this.result = result;
    this.memory = result.Memory;
    return this;
  }
  async send(data, Tags) {
    const result = await this.handle(
      this.memory,
      this.createMsg(data, Tags),
      this.createEnv()
    );
    this.result = result;
    this.memory = result.Memory;
    return result;
  }

  createMsg(data, Tags) {
    this.height += 1;
    return {
      Id: this.height,
      Target: this.env.process_id,
      Owner: this.env.owner,
      Data: data?.length ? data : "",
      "Block-Height": this.height.toString(),
      Timestamp: Date.now().toString(),
      Module: this.module,
      From: this.env.from,
      Cron: false,
      Tags: Tags?.length ? Tags : [{ name: "Action", value: "Eval" }],
    };
  }

  createEnv() {
    return {
      Process: {
        Id: this.env.process_id,
        Tags: [
          { name: "Data-Protocol", value: "ao" },
          { name: "Variant", value: "ao.TN.1" },
          { name: "Type", value: "Process" },
          { name: "Name", value: "TEST_PROCESS_OWNER" },
          {
            name: "Authority",
            value: "fcoN_xJeisVsPXA-trzVAuIiqO3ydLQxM-L4XbrQKzY",
          },
        ],
        Owner: this.env.owner,
      },
      Module: {
        Id: this.module,
        Tags: [
          { name: "Data-Protocol", value: "ao" },
          { name: "Variant", value: "ao.TN.1" },
          { name: "Type", value: "Module" },
        ],
      },
    };
  }
}
