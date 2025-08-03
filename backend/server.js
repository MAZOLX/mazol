require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// BNB Chain configuration
const BNB_RPC_URL = process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org/';
const provider = new ethers.JsonRpcProvider(BNB_RPC_URL);

// Token addresses
const MZLX_ADDRESS = '0x49F4a728BD98480E92dBfc6a82d595DA9d1F7b83';
const USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';

// Admin wallet
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
if (!ADMIN_PRIVATE_KEY) {
  console.error('ERROR: ADMIN_PRIVATE_KEY is not set in .env file');
  process.exit(1);
}
const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);

// ERC20 ABI
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

// Create contract instances
const mzlxContract = new ethers.Contract(MZLX_ADDRESS, ERC20_ABI, adminWallet);
const usdtContract = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);

// API endpoint to process purchases
app.post('/api/purchase', async (req, res) => {
  try {
    const { walletAddress, usdtAmount, mzlxAmount, txHash } = req.body;
    
    // Validate input
    if (!ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    if (isNaN(usdtAmount) || usdtAmount <= 0) {
      return res.status(400).json({ error: 'Invalid USDT amount' });
    }
    if (!txHash || !txHash.match(/^0x[a-fA-F0-9]{64}$/)) {
      return res.status(400).json({ error: 'Invalid transaction hash' });
    }
    
    // Verify the transaction
    const tx = await provider.getTransaction(txHash);
    if (!tx) {
      return res.status(400).json({ error: 'Transaction not found' });
    }
    
    // Check transaction receipt
    const receipt = await tx.wait();
    if (receipt.status !== 1) {
      return res.status(400).json({ error: 'Transaction failed' });
    }
    
    // Verify it's a USDT transfer to our address
    if (tx.to.toLowerCase() !== USDT_ADDRESS.toLowerCase()) {
      return res.status(400).json({ error: 'Invalid token transfer' });
    }
    
    // Check if we have enough MZLx tokens
    const mzlxValue = ethers.parseUnits(mzlxAmount.toString(), await mzlxContract.decimals());
    const mzlxBalance = await mzlxContract.balanceOf(adminWallet.address);
    if (mzlxBalance < mzlxValue) {
      return res.status(400).json({ error: 'Insufficient MZLx tokens in reserve' });
    }
    
    // Send MZLx tokens
    const sendTx = await mzlxContract.transfer(walletAddress, mzlxValue);
    await sendTx.wait();
    
    return res.json({
      success: true,
      message: 'MZLx tokens sent successfully',
      mzlxTxHash: sendTx.hash,
      mzlxAmount: mzlxAmount
    });
    
  } catch (error) {
    console.error('Purchase error:', error);
    return res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: error.reason || undefined
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`MAZOL Token Sale Backend running on port ${PORT}`);
  console.log(`Admin wallet: ${adminWallet.address}`);
});
