// download module from arweave and save to .ao_unittest
import { writeFileSync, readFileSync, createWriteStream } from "fs";
import { BUILD_FOLDER, AOS_SQLITE_MODULE, AOS_MODULE } from "./config.js";
import { assert } from "console";
import { Writable } from "stream";

function checkModule(id) {
  if (!id) {
    return AOS_MODULE;
  }
  if (id === "sqlite") {
    return AOS_SQLITE_MODULE;
  }
  assert(id?.length === 43, "Invalid module id");
}

export function fetchModule(id) {
  id = checkModule(id);
  console.log("Fetching module:", id);
  const fileStream = createWriteStream(`${BUILD_FOLDER}/module/${id}`);
  return fetch(`https://arweave.net/${id}`).then((res) => {
    if (!res.ok) {
      throw new Error(`Failed to fetch module: ${res.statusText}`);
    }
    return res.body.pipeTo(Writable.toWeb(fileStream));
  });
}

export function getModuleSync(id) {
  id = checkModule(id);
  return readFileSync(`${BUILD_FOLDER}/module/${id}`);
}
