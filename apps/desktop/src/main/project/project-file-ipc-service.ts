import {
  CreateProjectDesignFileRequestContract,
  ProjectDesignFileContract,
  ProjectDesignFileRequestContract,
  RenameProjectDesignFileRequestContract,
  RenameProjectDesignFileResultContract,
  SaveProjectDesignFileRequestContract,
} from "@/shared/project-file-contract.js";
import { requireContract } from "@/main/contract-parser.js";
import type { ProjectHost } from "./project-host.js";

export class ProjectFileIpcService {
  constructor(private readonly projectHost: ProjectHost) {}

  async create(request: unknown) {
    const canonicalRequest = requireContract(
      CreateProjectDesignFileRequestContract,
      request,
      "Design File create request",
    );
    const result = await this.projectHost.createDesignFile(
      canonicalRequest.projectId,
      {
        descriptor: canonicalRequest.descriptor,
        document: canonicalRequest.document,
      },
    );
    return requireContract(
      ProjectDesignFileContract,
      result,
      "Design File create response",
      { kind: "create", request: canonicalRequest },
    );
  }

  async read(request: unknown) {
    const canonicalRequest = requireContract(
      ProjectDesignFileRequestContract,
      request,
      "Design File read request",
    );
    const result = await this.projectHost.readDesignFile(
      canonicalRequest.projectId,
      canonicalRequest.designFileId,
    );
    return requireContract(
      ProjectDesignFileContract,
      result,
      "Design File read response",
      { kind: "read", request: canonicalRequest },
    );
  }

  async save(request: unknown) {
    const canonicalRequest = requireContract(
      SaveProjectDesignFileRequestContract,
      request,
      "Design File save request",
    );
    const result = await this.projectHost.saveDesignFile(
      canonicalRequest.projectId,
      canonicalRequest.designFileId,
      canonicalRequest.document,
    );
    return requireContract(
      ProjectDesignFileContract,
      result,
      "Design File save response",
      { kind: "save", request: canonicalRequest },
    );
  }

  async rename(request: unknown) {
    const canonicalRequest = requireContract(
      RenameProjectDesignFileRequestContract,
      request,
      "Design File rename request",
    );
    const result = await this.projectHost.renameDesignFile(
      canonicalRequest.projectId,
      canonicalRequest.designFileId,
      canonicalRequest.name,
    );
    return requireContract(
      RenameProjectDesignFileResultContract,
      result,
      "Design File rename response",
      { kind: "rename", request: canonicalRequest },
    );
  }
}
