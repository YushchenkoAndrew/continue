import { ToolImpl } from ".";
import { getNumberArg, getStringArg } from "../parseArgs";
import { readWindowedFile } from "./readWindow";

function optionalNumber(args: any, key: string): number | undefined {
  const raw = args?.[key];
  if (raw === undefined || raw === null || raw === "") return undefined;
  return getNumberArg(args, key);
}

export const readFileImpl: ToolImpl = async (args, extras) => {
  const filepath = getStringArg(args, "filepath");
  return readWindowedFile(
    filepath,
    extras,
    optionalNumber(args, "startLine") ?? 1,
    optionalNumber(args, "endLine"),
  );
};
