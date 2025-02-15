import semverSatisfies from 'semver/functions/satisfies'
import { getSafeSingletonDeployment, getSafeL2SingletonDeployment } from '@gnosis.pm/safe-deployments'
import Web3 from 'web3'
import { AbiItem } from 'web3-utils'

import { LATEST_SAFE_VERSION } from 'src/utils/constants'
import { getChainById, _getChainId } from 'src/config'
import { ChainId } from 'src/config/chain.d'
import { ZERO_ADDRESS } from 'src/logic/wallets/ethAddresses'
import { calculateGasOf, EMPTY_DATA } from 'src/logic/wallets/ethTransactions'
import { getWeb3 } from 'src/logic/wallets/getWeb3'
import { GnosisSafe } from 'src/types/contracts/gnosis_safe.d'
import { ProxyFactory } from 'src/types/contracts/proxy_factory.d'
import { CompatibilityFallbackHandler } from 'src/types/contracts/compatibility_fallback_handler.d'
import { SignMessageLib } from 'src/types/contracts/sign_message_lib.d'
import { MultiSend } from 'src/types/contracts/multi_send.d'
import { getSafeInfo } from 'src/logic/safe/utils/safeInformation'

import GnosisSafeL2ABI from 'src/artifacts/GnosisSafeL2.sol/GnosisSafeL2.json'
import ProxyFactoryABI from 'src/artifacts/proxies/GnosisSafeProxyFactory.sol/GnosisSafeProxyFactory.json'
import FallBackHandlerABI from 'src/artifacts/handler/CompatibilityFallbackHandler.sol/CompatibilityFallbackHandler.json'
import MultiSendDeploymentABI from 'src/artifacts/libraries/MultiSend.sol/MultiSend.json'
import SignMessageLibABI from 'src/artifacts/libraries/SignMessageLib.sol/SignMessageLib.json'

export const SENTINEL_ADDRESS = '0x0000000000000000000000000000000000000001'

interface ContractDeployment {
  MultiSend: string
  CompatibilityFallbackHandler: string
  GnosisSafeProxyFactory: string
  GnosisSafeL2: string
  SignMessageLib: string
}

type ChainToContract<K extends keyof any, T> = {
  [P in K]: T
}

const contracts: ChainToContract<string, ContractDeployment> = {
  '57': {
    MultiSend: '0x09645f834D432C0548B6c75F0cD4BEa2fCAac2Bd',
    CompatibilityFallbackHandler: '0xC397b8918a64f06b0dFba1653eCcE9fD68387326',
    GnosisSafeProxyFactory: '0x111dE2B36368ddDA41CCB0E335eb4a59A3750A1B',
    GnosisSafeL2: '0x7e1eaA0f4BBDD5501dAb7542B405Ab7fc343105F',
    SignMessageLib: '0x90305FB725E56e042E8f4078e85e02408cA5D4E0',
  } as ContractDeployment,
  '5700': {
    MultiSend: '0xe3e0CBe5CD22A111EB032C14D052838cd2d4eA07',
    CompatibilityFallbackHandler: '0x41279A031F6A7C42188a006746E0BAfA6d9cB343',
    GnosisSafeProxyFactory: '0x25622d7aB63452822B45B0bfa79e7D2be6b1aE04',
    GnosisSafeL2: '0x84C2130B89b080aC92b99d988480f63955BCA09A',
    SignMessageLib: '0x6586e66ceFaa4961361bAE42EB2c70d89220A576',
  } as ContractDeployment,
}

let proxyFactoryMaster: ProxyFactory
let safeMaster: GnosisSafe
let fallbackHandler: CompatibilityFallbackHandler
let multiSend: MultiSend

const getSafeContractDeployment = ({ safeVersion }: { safeVersion: string }) => {
  // We check if version is prior to v1.0.0 as they are not supported but still we want to keep a minimum compatibility
  const useOldestContractVersion = semverSatisfies(safeVersion, '<1.0.0')
  // We have to check if network is L2
  const networkId = _getChainId()
  const chainConfig = getChainById(networkId)
  // We had L1 contracts in three L2 networks, xDai, EWC and Volta so even if network is L2 we have to check that safe version is after v1.3.0
  const useL2ContractVersion = chainConfig.l2 && semverSatisfies(safeVersion, '>=1.3.0')
  const getDeployment = useL2ContractVersion ? getSafeL2SingletonDeployment : getSafeSingletonDeployment

  return (
    getDeployment({
      version: safeVersion,
      network: networkId.toString(),
    }) ||
    getDeployment({
      version: safeVersion,
    }) ||
    // In case we couldn't find a valid deployment and it's a version before 1.0.0 we return v1.0.0 to allow a minimum compatibility
    (useOldestContractVersion
      ? getDeployment({
          version: '1.0.0',
        })
      : undefined)
  )
}

/**
 * Creates a Contract instance of the GnosisSafe contract
 * @param {Web3} web3
 * @param {ChainId} chainId
 */
const getGnosisSafeContractInstance = (web3: Web3, chainId: ChainId): GnosisSafe => {
  // const safeSingletonDeployment = getSafeContractDeployment({ safeVersion: LATEST_SAFE_VERSION })
  const contractAddress = contracts[chainId].GnosisSafeL2

  if (!contractAddress) {
    throw new Error(`GnosisSafe contract not found for chainId: ${chainId}`)
  }

  return new web3.eth.Contract(GnosisSafeL2ABI.abi as AbiItem[], contractAddress) as unknown as GnosisSafe
}

/**
 * Creates a Contract instance of the GnosisSafeProxyFactory contract
 * @param {Web3} web3
 * @param {ChainId} chainId
 */
const getProxyFactoryContractInstance = (web3: Web3, chainId: ChainId): ProxyFactory => {
  // const proxyFactoryDeployment =
  //   getProxyFactoryDeployment({
  //     version: LATEST_SAFE_VERSION,
  //     network: chainId.toString(),
  //   }) ||
  //   getProxyFactoryDeployment({
  //     version: LATEST_SAFE_VERSION,
  //   })
  const contractAddress = contracts[chainId].GnosisSafeProxyFactory

  if (!contractAddress) {
    throw new Error(`GnosisSafeProxyFactory contract not found for chainId: ${chainId}`)
  }

  return new web3.eth.Contract(ProxyFactoryABI.abi as AbiItem[], contractAddress) as unknown as ProxyFactory
}

/**
 * Creates a Contract instance of the FallbackHandler contract
 * @param {Web3} web3
 * @param {ChainId} chainId
 */
const getFallbackHandlerContractInstance = (web3: Web3, chainId: ChainId): CompatibilityFallbackHandler => {
  // const fallbackHandlerDeployment =
  //   getFallbackHandlerDeployment({
  //     version: LATEST_SAFE_VERSION,
  //     network: chainId.toString(),
  //   }) ||
  //   getFallbackHandlerDeployment({
  //     version: LATEST_SAFE_VERSION,
  //   })
  const contractAddress = contracts[chainId].CompatibilityFallbackHandler

  if (!contractAddress) {
    throw new Error(`FallbackHandler contract not found for chainId: ${chainId}`)
  }

  return new web3.eth.Contract(
    FallBackHandlerABI.abi as AbiItem[],
    contractAddress,
  ) as unknown as CompatibilityFallbackHandler
}

/**
 * Creates a Contract instance of the MultiSend contract
 * @param {Web3} web3
 * @param {ChainId} chainId
 */
const getMultiSendContractInstance = (web3: Web3, chainId: ChainId): MultiSend => {
  // const multiSendDeployment =
  //   getMultiSendCallOnlyDeployment({
  //     network: chainId.toString(),
  //   }) || getMultiSendCallOnlyDeployment()
  const contractAddress = contracts[chainId].MultiSend

  if (!contractAddress) {
    throw new Error(`MultiSend contract not found for chainId: ${chainId}`)
  }

  return new web3.eth.Contract(MultiSendDeploymentABI.abi as AbiItem[], contractAddress) as unknown as MultiSend
}

/**
 * Returns an address of SignMessageLib for passed chainId
 * @param {ChainId} chainId
 * @returns {string}
 */
export const getSignMessageLibAddress = (chainId: ChainId): string | undefined => {
  // const signMessageLibDeployment =
  //   getSignMessageLibDeployment({
  //     network: chainId.toString(),
  //   }) || getSignMessageLibDeployment()
  const contractAddress = contracts[chainId].SignMessageLib

  if (!contractAddress) {
    throw new Error(`SignMessageLib contract not found for chainId: ${chainId}`)
  }

  return contractAddress
}

/**
 * Returns a Web3 Contract instance of the SignMessageLib contract
 * @param {Web3} web3
 * @param {ChainId} chainId
 * @returns {SignMessageLib}
 */
export const getSignMessageLibContractInstance = (web3: Web3, chainId: ChainId): SignMessageLib => {
  // const signMessageLibDeployment =
  //   getSignMessageLibDeployment({
  //     network: chainId.toString(),
  //   }) || getSignMessageLibDeployment()
  const contractAddress = contracts[chainId].SignMessageLib

  if (!contractAddress) {
    throw new Error(`SignMessageLib contract not found for chainId: ${chainId}`)
  }

  return new web3.eth.Contract(SignMessageLibABI.abi as AbiItem[], contractAddress) as unknown as SignMessageLib
}

export const getMasterCopyAddressFromProxyAddress = async (proxyAddress: string): Promise<string | undefined> => {
  let masterCopyAddress: string | undefined
  try {
    const res = await getSafeInfo(proxyAddress)
    masterCopyAddress = res.implementation.value
    if (!masterCopyAddress) {
      console.error(`There was not possible to get masterCopy address from proxy ${proxyAddress}.`)
    }
  } catch (e) {
    e.log()
  }
  return masterCopyAddress
}

export const instantiateSafeContracts = () => {
  const web3 = getWeb3()
  const chainId = _getChainId()

  // Create ProxyFactory Master Copy
  proxyFactoryMaster = getProxyFactoryContractInstance(web3, chainId)

  // Create Safe Master copy
  safeMaster = getGnosisSafeContractInstance(web3, chainId)

  // Create Fallback Handler
  fallbackHandler = getFallbackHandlerContractInstance(web3, chainId)

  // Create MultiSend contract
  multiSend = getMultiSendContractInstance(web3, chainId)
}

export const getSafeMasterContract = () => {
  instantiateSafeContracts()
  return safeMaster
}

export const getSafeMasterContractAddress = () => {
  return safeMaster.options.address
}

export const getFallbackHandlerContractAddress = () => {
  return fallbackHandler.options.address
}

export const getMultisendContract = () => {
  return multiSend
}

export const getMultisendContractAddress = () => {
  return multiSend.options.address
}

export const getSafeDeploymentTransaction = (
  safeAccounts: string[],
  numConfirmations: number,
  safeCreationSalt: number,
) => {
  const gnosisSafeData = safeMaster.methods
    .setup(
      safeAccounts,
      numConfirmations,
      ZERO_ADDRESS,
      EMPTY_DATA,
      fallbackHandler.options.address,
      ZERO_ADDRESS,
      0,
      ZERO_ADDRESS,
    )
    .encodeABI()
  return proxyFactoryMaster.methods.createProxyWithNonce(safeMaster.options.address, gnosisSafeData, safeCreationSalt)
}

export const estimateGasForDeployingSafe = async (
  safeAccounts: string[],
  numConfirmations: number,
  userAccount: string,
  safeCreationSalt: number,
) => {
  const proxyFactoryData = getSafeDeploymentTransaction(safeAccounts, numConfirmations, safeCreationSalt).encodeABI()

  return calculateGasOf({
    data: proxyFactoryData,
    from: userAccount,
    to: proxyFactoryMaster.options.address,
  }).then((value) => value * 2)
}

export const getGnosisSafeInstanceAt = (safeAddress: string, safeVersion: string): GnosisSafe => {
  const safeSingletonDeployment = getSafeContractDeployment({ safeVersion })

  const web3 = getWeb3()
  return new web3.eth.Contract(safeSingletonDeployment?.abi as AbiItem[], safeAddress) as unknown as GnosisSafe
}
