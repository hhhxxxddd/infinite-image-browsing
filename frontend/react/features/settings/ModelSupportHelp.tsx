import { Stack, Table, Text } from '@mantine/core'

export default function ModelSupportHelp() {
  return (
    <Stack gap="sm">
      <Text fw={650} size="sm">
        支持的本地模型
      </Text>
      <Table verticalSpacing="xs" horizontalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>用途</Table.Th>
            <Table.Th>模型系列</Table.Th>
            <Table.Th>规格与格式</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          <Table.Tr>
            <Table.Td>图文检索</Table.Td>
            <Table.Td>Qwen3-VL-Embedding</Table.Td>
            <Table.Td>
              2B / 8B · Safetensors
              <br />
              8B · GGUF
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>结果重排</Table.Td>
            <Table.Td>Qwen3-VL-Reranker</Table.Td>
            <Table.Td>
              2B / 8B · Safetensors
              <br />
              8B · GGUF
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>图片理解</Table.Td>
            <Table.Td>Qwen3-VL-Instruct</Table.Td>
            <Table.Td>
              2B / 8B · Safetensors
              <br />
              原精度 / INT8 / NF4
              <br />
              8B · GGUF
            </Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
      <Text size="xs">
        内置 GGUF 下载提供 8B Q6_K。同一用途、同一版本的 8B 模型也可使用其他 GGUF 量化，如
        Q4_K_M、Q5_K_M、Q8_0，填写模型路径后保存即可；需匹配视觉文件和当前引擎。已实测的组合为 Q6_K
        主模型 + F16 mmproj。
      </Text>
      <Text size="xs" c="dimmed">
        Embedding 更换版本或量化后需重建图片索引，Reranker 与 Instruct 不需要。三类模型用途不同，
        Instruct 用于图片理解，不能替代 Embedding 或 Reranker。
      </Text>
    </Stack>
  )
}
