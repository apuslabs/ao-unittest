import { BUILD_FOLDER, AOS_SQLITE_MODULE, AOS_MODULE } from "./config.js";
import { assert } from "console";
import { Writable } from "stream";
import { createWriteStream, existsSync, readFileSync } from "fs";
import { ensureDirSync } from "fs-extra";

export function fetchModule(id) {
  console.log("Fetching module:", id);
  const fileStream = createWriteStream(`${BUILD_FOLDER}/module/${id}`);
  return fetch(`https://arweave.net/${id}`).then((res) => {
    if (!res.ok) {
      throw new Error(`Failed to fetch module: ${res.statusText}`);
    }
    return res.body.pipeTo(Writable.toWeb(fileStream));
  });
}

export async function getModuleSync(id) {
  // if file does not exist, fetch from arweave
  ensureDirSync(`${BUILD_FOLDER}/module`);
  if (!existsSync(`${BUILD_FOLDER}/module/${id}`)) {
    await fetchModule(id);
  }
  return readFileSync(`${BUILD_FOLDER}/module/${id}`);
}
