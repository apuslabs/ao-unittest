local luaunit = require('libs.luaunit')
local Token = require('token')
local Utils = require('libs.utils')

TestToken = {}

function TestToken:testInfo()
    local msg = { From = "user1" }
    Token.info(msg)
    local message = Utils.getLatestMessage()
    luaunit.assertNotNil(message)
    luaunit.assertEquals(Utils.getValueFromTags(message.Tags, "Action"), "Info-Response")
    luaunit.assertEquals(Utils.getValueFromTags(message.Tags, "Name"), "Apus")
    luaunit.assertEquals(Utils.getValueFromTags(message.Tags, "Ticker"), "Apus")
    luaunit.assertEquals(Utils.getValueFromTags(message.Tags, "Denomination"), "12")
end

function TestToken:testBurn()
    local msg = { From = "user1", Quantity = "30" }
    Balances = { user1 = "100" }
    TotalSupply = "1000"

    Token.burn(msg)
    luaunit.assertEquals(Balances.user1, "70")
    luaunit.assertEquals(TotalSupply, "970")
    local message = Utils.getLatestMessage()
    luaunit.assertStrContains(message.Data, "Successfully burned")
end

luaunit.LuaUnit.run()