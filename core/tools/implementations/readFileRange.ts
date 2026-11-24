import { ToolImpl } from ".";
import { getNumberArg, getStringArg } from "../parseArgs";
import { readWindowedFile } from "./readWindow";

// Kept for backwards compatibility with tool-call history and configs.
export const MAX_CHAR_POSITION = 2147483647;

export const readFileRangeImpl: ToolImpl = async (args, extras) => {
  return readWindowedFile(
    getStringArg(args, "filepath"),
    extras,
    getNumberArg(args, "startLine"),
    getNumberArg(args, "endLine"),
  );
};
