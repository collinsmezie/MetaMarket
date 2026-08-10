Basic Flow 
customer places a phone call
system answers via twilio
system identifies user via phone number or saves the number for later use
cutomer selects if they want to buy or sell or they already have an ongoing transaction
if customer selects "buy" they are asked what they want to buy
if customer selects "sell" they are asked what they want to sell
Buy-flow
Customer selects "buy"
System asks what they want to buy
Customer says what they want to buy
System uses product-search-workflow to handle request (especially to understand intent and clarify)
System asks which channel the user would like to receive the list of vendors in eg whatsapp or sms
System assures the user that it will connect them with capable vendors, greets them and ends the call
System handoffs to product-search-workflow to handle the rest of the search-and-delivery-channels process
System sends a WhatsApp message and sms to the user with the list of capable vendors.

