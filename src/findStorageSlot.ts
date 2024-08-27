import { program } from 'commander'
import {
  http,
  createPublicClient,
  encodeAbiParameters,
  erc20Abi,
  isAddress,
  keccak256,
  maxUint256,
  parseAbiItem,
  parseAbiParameters,
} from 'viem'
import type { Address, Hex, PublicClient } from 'viem'
import * as networks from 'viem/chains'
import { prompt } from './promptUtils'

type Network = (typeof networks)[keyof typeof networks]
const networkChoices = Object.entries(networks).map(([name, network]) => ({
  title: name,
  value: network,
}))

export function getAddressMappingStorageSlotForVyper(slot: Hex, address: Address) {
  return keccak256(encodeAbiParameters(parseAbiParameters('bytes32, address'), [slot, address]))
}

export function getAddressMappingStorageSlotForSolidity(slot: Hex, address: Address) {
  return keccak256(encodeAbiParameters(parseAbiParameters('address, bytes32'), [address, slot]))
}

const numToBytes = (num: number | bigint): Hex => `0x${num.toString(16).padStart(64, '0')}`

async function findStorageSlot(client: PublicClient, address: Hex, holder: Address, amountToFind: bigint) {
  const amount = numToBytes(amountToFind)

  for (let i = 0; i < maxUint256; i++) {
    console.log(`Scanning for ${i}`)
    const slot = numToBytes(i)

    const storageSlotSolidity = getAddressMappingStorageSlotForSolidity(slot, holder)
    const storageSlotVyper = getAddressMappingStorageSlotForVyper(slot, holder)

    if ((await client.getStorageAt({ address, slot: storageSlotSolidity })) === amount) {
      console.log('Slot found solidity')
      console.log(slot)
      break
    }
    if ((await client.getStorageAt({ address, slot: storageSlotVyper })) === amount) {
      console.log('Slot found vyper')
      console.log(slot)
      break
    }
  }
}

async function findTokenHolder(address: Hex, client: PublicClient) {
  async function findEvent(toBlock: bigint) {
    const fromBlock = toBlock - 100n
    const logs = await client.getLogs({
      address,
      event: parseAbiItem('event Transfer(address indexed _from, address indexed _to, uint256 _value)'),
      toBlock,
      fromBlock,
    })
    if (logs.length === 0) {
      return findEvent(fromBlock)
    }
    for (const log of logs) {
      const to = log.args._to as Hex
      const from = log.args._from as Hex

      if ((await getTokenBalance(client, address, to)) > 0n) return to
      if ((await getTokenBalance(client, address, from)) > 0n) return from
    }
    return findEvent(fromBlock)
  }

  const currentBlock = await client.getBlockNumber()
  const holder = await findEvent(currentBlock)

  return holder
}

function getTokenBalance(client: PublicClient, token: Hex, holder: Hex) {
  return client.readContract({
    abi: erc20Abi,
    address: token,
    functionName: 'balanceOf',
    args: [holder],
  })
}

async function getStorageAddress(token: Hex): Promise<Hex> {
  const sameAsToken = await prompt({
    type: 'toggle',
    message: 'Storage address same as token ?',
    active: 'yes',
    inactive: 'no',
    initial: true,
  })
  if (sameAsToken) return token

  const storageAddress = await prompt<Hex>({
    type: 'text',
    message: 'Storage Address',
    validate: isAddress,
  })
  return storageAddress
}

interface Options {
  holder?: Address
}

async function performAction(options: Options) {
  const selectedNetwork = await prompt<Network>({
    type: 'autocomplete',
    message: 'Select network',
    choices: networkChoices,
  })
  if (!selectedNetwork) throw new Error('No network')

  const token = await prompt<Hex>({
    type: 'text',
    message: 'Token Address',
    validate: isAddress,
  })
  if (!selectedNetwork || !token) throw new Error('No token')

  const storageAddress = await getStorageAddress(token)

  const client = (await createPublicClient({
    chain: selectedNetwork,
    transport: http(),
  })) as PublicClient

  const holder = options.holder || (await findTokenHolder(token, client))

  if (!holder) throw new Error('No holder found')
  const balance = await getTokenBalance(client, token, holder)
  if (balance === 0n) throw new Error('Holder has no balance found')

  await findStorageSlot(client, storageAddress, holder, balance)
}

async function run() {
  program
    .name('findStorageSlot')
    .description('Find storage slot of token balances for gas estimation')
    .option(
      '-h, --holder',
      'Holder of tokens to find storage slot for. Omit to use most recent recipient of tokens from Transfer event'
    )
    .helpOption('-h, --help', 'Display this help message.')
    .action(performAction)

  program.parse()
}

run()
