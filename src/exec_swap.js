const {
    Market,
    Liquidity,
    TokenAmount,
    jsonInfo2PoolKeys,
    buildSimpleTransaction
} = require('@raydium-io/raydium-sdk');

const {
    Keypair,
    VersionedTransaction,
    PublicKey,
} = require('@solana/web3.js')

const bs58 = require('bs58')

const {
    connection,
    makeTxVersion,
    addLookupTableInfo
} = require('../config.js')

const {
    getWalletTokenAccount,
    formatAmmKeysById,
    sleepTime
} = require('./util.js')

async function execSwap(input) {
    console.log("swap pool info", input.poolInfo)
    console.log("swap market info", input.marketInfo)

    console.log("swap started for", input.wallet);
    const myKeyPair = Keypair.fromSecretKey(new Uint8Array(bs58.decode(input.wallet)));
    const myPublicKey = myKeyPair.publicKey

    // -------- pre-action: get pool info --------
    // const targetPoolInfo = await formatAmmKeysById(input.targetPool)
    let targetPoolInfo;
    while (true) {
        try {
            targetPoolInfo = await formatAmmKeysById(input.targetPool);
            if (targetPoolInfo) {
                console.log("targetPoolInfo", targetPoolInfo)
                break; // If successful, exit the loop
            }
        } catch (error) {
            console.error('pool not found, retrying...');
        }
        await sleepTime(1000); // Wait for 1 seconds before retrying
    }
    const poolKeys = jsonInfo2PoolKeys(targetPoolInfo)
    // console.log("poolKeys", poolKeys)

    // -------- step 1: coumpute amount out --------
    let poolInfo;
    while (true) {
        try {
            poolInfo = await Liquidity.fetchInfo({ connection, poolKeys })
            if (poolInfo) {
                console.log("swap poolInfo", poolInfo)
                break; // If successful, exit the loop
            }
        } catch (error) {
            console.error('cannot fetch swap info, retrying...');
        }
        await sleepTime(3000); // Wait for 1 seconds before retrying
    }
    const poolInfoCustom = {
        baseReserve: input.addBaseAmount,
        quoteReserve: input.addQuoteAmount
    }


    const { amountIn, maxAmountIn } = Liquidity.computeAmountIn({
        poolKeys: poolKeys,
        poolInfo: poolInfo,
        amountOut: input.outputTokenAmount,
        currencyIn: input.inputToken,
        slippage: input.slippage,
    })

    // hard_coded
    // const maxAmountIn = new TokenAmount(input.inputToken, 100000000000)
    console.log("maxAmouttIn", maxAmountIn)

    const walletTokenAccounts = await getWalletTokenAccount(connection, myPublicKey)

    const instruction = await Liquidity.makeSwapInstructionSimple({
        connection,
        poolKeys,
        userKeys: {
            tokenAccounts: walletTokenAccounts,
            owner: myPublicKey
        },
        amountIn: maxAmountIn,
        amountOut: input.outputTokenAmount,
        fixedSide: 'out',
        makeTxVersion,
    })
    const { innerTransactions } = instruction

    // const txids = await buildAndSendTx(innerTransactions, { skipPreflight: true })
    // console.log("txids", txids)

    // return txids
    const willSendTx = await buildSimpleTransaction({
        connection,
        makeTxVersion,
        payer: myPublicKey,
        innerTransactions,
        addLookupTableInfo: addLookupTableInfo,
    })

    const txids = [];
    for (const iTx of willSendTx) {
        if (iTx instanceof VersionedTransaction) {
            iTx.sign([myKeyPair]);
            txids.push(await connection.sendTransaction(iTx, { skipPreflight: true }));
        } else {
            txids.push(await connection.sendTransaction(iTx, [myKeyPair], { skipPreflight: true }));
        }
    }
    console.log("swapped for ", myPublicKey)
    console.log("txids : ", txids)
    // return txids;
}

// function getMarketAssociatedPoolKeys(input) {
//     return Liquidity.getAssociatedPoolKeys({
//         version: 4,
//         marketVersion: 3,
//         baseMint: input.baseToken,
//         quoteMint: input.quoteToken,
//         baseDecimals: input.baseToken.decimals,
//         quoteDecimals: input.quoteToken.decimals,
//         marketId: input.targetMarketId,
//         programId: input.programId,
//         marketProgramId: input.marketProgramId,
//     })
// }

module.exports = {
    execSwap
}