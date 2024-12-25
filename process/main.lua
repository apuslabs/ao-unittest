Token = require('token')

Handlers.add("token.info", Handlers.utils.hasMatchingTag("Action","Info"), Token.info)
Handlers.add("token.balance", "Balance", Token.balance)
Handlers.add("token.balances", "Balances", Token.balances)
Handlers.add("token.totalSupply", "Total-Supply", Token.totalSupply)
Handlers.add("token.burn", "Burn", Token.burn)
Handlers.add("token.mintedSupply", "Minted-Supply", Token.mintedSupply)
