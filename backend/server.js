require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const BNB_RPC_URL = process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org/';
const MZLX_ADDRESS = process.env.MZLX_ADDRESS || '0x49F4a728BD98480E92dBfc6a82d595DA9d1F7b83';
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;

// Validate private key
if (!ADMIN_PRIVATE_KEY || !/^[0-9a-fA-F]{64}$/.test(ADMIN_PRIVATE_KEY)) {
  console.error('ERROR: Invalid private key format');
  process.exit(1);
}

// Setup
const provider = new ethers.JsonRpcProvider(BNB_RPC_URL);
const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);

// ERC20 ABI
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

const mzlxContract = new ethers.Contract(MZLX_ADDRESS, ERC20_ABI, adminWallet);

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/api/health', async (req, res) => {
  try {
    const [balance, decimals] = await Promise.all([
      mzlxContract.balanceOf(adminWallet.address),
      mzlxContract.decimals()
    ]);
    
    res.json({ 
      status: 'active',
      chainId: 56,
      adminWallet: adminWallet.address,
      mzlxBalance: ethers.formatUnits(balance, decimals),
      network: 'BNB Smart Chain'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

app.post('/api/purchase', async (req, res) => {
  try {
    const { walletAddress, usdtAmount, mzlxAmount } = req.body;

    // Validate input
    if (!ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    if (isNaN(usdtAmount) || usdtAmount <= 0) {
      return res.status(400).json({ error: 'Invalid USDT amount' });
    }

    // Get decimals
    const decimals = await mzlxContract.decimals();
    const mzlxValue = ethers.parseUnits(mzlxAmount.toString(), decimals);
    
    // Send tokens
    const tx = await mzlxContract.transfer(walletAddress, mzlxValue);
    const receipt = await tx.wait();
    
    if (receipt.status !== 1) {
      return res.status(500).json({ error: 'Transaction failed' });
    }

    res.json({
      success: true,
      message: 'MZLx tokens sent',
      transactionHash: tx.hash,
      mzlxAmount: mzlxAmount,
      receiver: walletAddress
    });

  } catch (error) {
    console.error('Purchase error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/', (req, res) => {
  res.redirect('https://mazolx.github.io/mazol/');
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 MAZOL Token Sale Backend running on port ${PORT}`);
  console.log(`🔐 Admin Wallet: ${adminWallet.address}`);
  console.log(`🔗 RPC: ${BNB_RPC_URL}`);
  console.log(`💎 MZLX Contract: ${MZLX_ADDRESS}`);
});
