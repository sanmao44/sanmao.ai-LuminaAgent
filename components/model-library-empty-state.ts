export function modelLibraryEmptyStateCopy(input: { modelCount: number; providerCount: number }) {
  if (input.modelCount > 0) {
    return input.providerCount > 0
      ? {
          title: "模型暂不可见",
          description: "已有模型记录。请到接口服务检查对应服务商是否已加入模型库。",
          actionLabel: "检查已有服务商",
        }
      : {
          title: "模型暂不可见",
          description: "模型记录仍在，但当前没有接口服务配置。请重新配置服务商后查看模型。",
          actionLabel: "查看接口服务",
        };
  }

  return input.providerCount > 0
    ? {
        title: "还没有读取模型",
        description: "已有接口服务配置。前往接口服务读取模型列表，也可以继续添加新的服务商。",
        actionLabel: "管理接口服务",
      }
    : {
        title: "还没有读取模型",
        description: "先添加接口服务，再读取它提供的模型列表。",
        actionLabel: "添加接口服务",
      };
}
