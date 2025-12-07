use anchor_lang::prelude::*;
use anchor_lang::system_program;
use solana_program::pubkey;

declare_id!("4dZuWfAH3HeU79Bd1ajUgr4RM2gGJywH2wHQfG8wQeAV");

// Constants
pub const PROGRAM_OWNER: Pubkey = pubkey!("8a6yEDSFf78hCbUz84jhfq7tkBMS91X1LrnyPiE8xUMo");
pub const PROJECT_TREASURY: Pubkey = pubkey!("8a6yEDSFf78hCbUz84jhfq7tkBMS91X1LrnyPiE8xUMo");
pub const TREASURY_FEE_BPS: u16 = 500;
pub const USER_ABSOLUTE_TICKET_CAP: u64 = 100;

#[program]
pub mod eithr_fun {
    use super::*;

    // Initialize MARKET
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        title: String,
        description: String,
        side_a: String,
        side_b: String,
        ticket_price: u64,
        category: String,
        duration: u64,
    ) -> Result<()> {
        // require!(
        //     ctx.accounts.payer.key() == PROGRAM_OWNER,
        //     ::Unauthorized
        // );

        let clock = Clock::get()?;
        let market_data = &mut ctx.accounts.market_data;

        require!(
            title.as_bytes().len() <= MarketData::MAX_TITLE_LEN,
            EithrError::TitleTooLong
        );
        require!(
            description.as_bytes().len() <= MarketData::MAX_DESC_LEN,
            EithrError::DescriptionTooLong
        );
        require!(
            side_a.as_bytes().len() <= MarketData::MAX_SIDE_LEN &&
            side_b.as_bytes().len() <= MarketData::MAX_SIDE_LEN,
            EithrError::SideTooLong
        );
        require!(
            category.as_bytes().len() <= MarketData::MAX_CATEGORY_LEN,
            EithrError::CategoryTooLong
        );
        require!(ticket_price > 0, EithrError::InvalidTicketPrice);
        require!(duration > 0, EithrError::InvalidDuration);

        market_data.title = title;
        market_data.description = description;
        market_data.side_a = side_a;
        market_data.side_b = side_b;
        market_data.category = category;

        market_data.ticket_price = ticket_price;

        market_data.duration = duration;
        market_data.creation_time = clock.unix_timestamp as u64;

        market_data.treasury_address = ctx.accounts.treasury_account.key();
        market_data.creator = ctx.accounts.payer.key();
        market_data.authority = PROGRAM_OWNER;

        market_data.encryptor = String::new();

        market_data.total_tickets = 0;
        market_data.total_amount = 0;
        market_data.is_finalized = false;
        market_data.is_revealed = false;

        market_data.winning_side = 0;

        market_data.total_tickets_side_a = 0;
        market_data.total_tickets_side_b = 0;
        market_data.total_amount_side_a = 0;
        market_data.total_amount_side_b = 0;

        Ok(())
    }

    pub fn buy_tickets(
        ctx: Context<BuyTickets>,
        encoded_side_hash: String,
        count_of_tickets: u64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let now = clock.unix_timestamp as u64;

        let market = &mut ctx.accounts.market_data;
        let user_tickets = &mut ctx.accounts.user_tickets;

        let end_time = market
            .creation_time
            .checked_add(market.duration)
            .ok_or(EithrError::Overflow)?;

        require!(now <= end_time, EithrError::MarketClosed);
        require!(!market.is_finalized, EithrError::MarketFinalized);

        require!(count_of_tickets > 0, EithrError::InvalidTicketCount);

        require!(
            encoded_side_hash.as_bytes().len() <= UserChoiceEntry::MAX_ENCODED_HASH_LEN,
            EithrError::EncodedHashTooLong
        );

        let price_per_ticket = market.ticket_price;
        let total_price = price_per_ticket
            .checked_mul(count_of_tickets)
            .ok_or(EithrError::Overflow)?;

        let new_total_market_tickets = market
            .total_tickets
            .checked_add(count_of_tickets)
            .ok_or(EithrError::Overflow)?;

        let new_total_user_tickets = user_tickets
            .total_tickets
            .checked_add(count_of_tickets)
            .ok_or(EithrError::Overflow)?;

        let dynamic_limit = new_total_market_tickets / 4;

        let allowed_max_for_user = if dynamic_limit < USER_ABSOLUTE_TICKET_CAP {
            USER_ABSOLUTE_TICKET_CAP
        } else {
            dynamic_limit
        };

        require!(
            new_total_user_tickets <= allowed_max_for_user,
            EithrError::UserTicketLimitExceeded
        );

        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.treasury_account.to_account_info(),
            },
        );
        system_program::transfer(cpi_ctx, total_price)?;

        market.total_tickets = new_total_market_tickets;
        market.total_amount = market
            .total_amount
            .checked_add(total_price)
            .ok_or(EithrError::Overflow)?;

        user_tickets.market = market.key();
        user_tickets.user = ctx.accounts.payer.key();
        user_tickets.total_tickets = new_total_user_tickets;
        user_tickets.total_amount = user_tickets
            .total_amount
            .checked_add(total_price)
            .ok_or(EithrError::Overflow)?;

        require!(
            user_tickets.choices.len() < UserTickets::MAX_CHOICES,
            EithrError::TooManyChoicesForUser
        );

        user_tickets.choices.push(UserChoiceEntry {
            encoded_side_hash,
            ticket_count: count_of_tickets,
            creation_time: now,
        });

        Ok(())
    }

    pub fn finalize_market(
        ctx: Context<FinalizeMarket>,
        total_tickets_side_a: u64,
        total_tickets_side_b: u64,
        total_amount_side_a: u64,
        total_amount_side_b: u64,
        winning_side: u8, // 1 = side_a, 2 = side_b
        encryptor_key: String, 
    ) -> Result<()> {
        let clock = Clock::get()?;
        let now = clock.unix_timestamp as u64;

        let market = &mut ctx.accounts.market_data;

        require_keys_eq!(
            ctx.accounts.authority.key(),
            market.authority,
            EithrError::Unauthorized
        );

        require!(!market.is_finalized, EithrError::MarketFinalized);

        let end_time = market
            .creation_time
            .checked_add(market.duration)
            .ok_or(EithrError::Overflow)?;
        require!(now >= end_time, EithrError::MarketNotEnded);

        require!(
            winning_side == 0 || winning_side == 1 || winning_side == 2,
            EithrError::InvalidWinningSide
        );

        let sum_tickets = total_tickets_side_a
            .checked_add(total_tickets_side_b)
            .ok_or(EithrError::Overflow)?;
        require!(
            sum_tickets == market.total_tickets,
            EithrError::InconsistentTotals
        );

        let sum_amounts = total_amount_side_a
            .checked_add(total_amount_side_b)
            .ok_or(EithrError::Overflow)?;
        require!(
            sum_amounts == market.total_amount,
            EithrError::InconsistentTotals
        );

        require!(
            encryptor_key.as_bytes().len() <= MarketData::MAX_ENCRYPTOR_LEN,
            EithrError::EncryptorTooLong
        );

        market.encryptor = encryptor_key;

        market.total_tickets_side_a = total_tickets_side_a;
        market.total_tickets_side_b = total_tickets_side_b;
        market.total_amount_side_a = total_amount_side_a;
        market.total_amount_side_b = total_amount_side_b;

        market.winning_side = winning_side;
        market.is_finalized = true;
        market.is_revealed = true;

        Ok(())
    }

    pub fn claim_reward(
        ctx: Context<ClaimReward>,
        claim_amount: u64,
    ) -> Result<()> {
        let market = &ctx.accounts.market_data;
        let user_tickets = &mut ctx.accounts.user_tickets;

        require_keys_eq!(
            ctx.accounts.authority.key(),
            market.authority,
            EithrError::Unauthorized
        );
        require_keys_eq!(
            ctx.accounts.user.key(),
            user_tickets.user,
            EithrError::UnauthorizedUser
        );

        require!(market.is_finalized, EithrError::MarketNotFinalized);

        require!(!user_tickets.has_claimed, EithrError::AlreadyClaimed);
        require!(claim_amount > 0, EithrError::InvalidClaimAmount);

        require_keys_eq!(
            ctx.accounts.project_treasury.key(),
            PROJECT_TREASURY,
            EithrError::InvalidProjectTreasury
        );

        let treasury_lamports = ctx.accounts.treasury_account.lamports();

        let rent = Rent::get()?;
        let min_lamports = rent.minimum_balance(ctx.accounts.treasury_account.data_len());

        let remaining = treasury_lamports
            .checked_sub(claim_amount)
            .ok_or(EithrError::Overflow)?;

        require!(
            remaining >= min_lamports,
            EithrError::InsufficientFunds
        );

        let (fee, user_amount) = if market.winning_side == 0 {
            (0u64, claim_amount)
        } else {
            let fee_u128 = (claim_amount as u128)
                .checked_mul(TREASURY_FEE_BPS as u128)
                .ok_or(EithrError::Overflow)?
                / 10_000u128;

            let fee = fee_u128 as u64;
            let user_amount = claim_amount
                .checked_sub(fee)
                .ok_or(EithrError::Overflow)?;
            (fee, user_amount)
        };

        let (expected_treasury, treasury_bump) = Pubkey::find_program_address(
            &[b"treasury_account", ctx.accounts.market_key.key().as_ref()],
            &crate::id(),
        );
        require_keys_eq!(
            expected_treasury,
            ctx.accounts.treasury_account.key(),
            EithrError::InvalidTreasuryPda
        );


        let market_key = ctx.accounts.market_key.key();
        let signer_seeds: &[&[u8]] = &[
            b"treasury_account",
            market_key.as_ref(),
            &[treasury_bump],
        ];
        let signer = &[signer_seeds];

        let cpi_ctx_user = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.treasury_account.to_account_info(),
                to: ctx.accounts.user.to_account_info(),
            },
            signer,
        );
        system_program::transfer(cpi_ctx_user, user_amount)?;

        if fee > 0 {
            let cpi_ctx_fee = CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.treasury_account.to_account_info(),
                    to: ctx.accounts.project_treasury.to_account_info(),
                },
                signer,
            );
            system_program::transfer(cpi_ctx_fee, fee)?;
        }

        user_tickets.has_claimed = true;

        Ok(())
    }


}

#[derive(Accounts)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        seeds = [b"market_data", market_key.key().as_ref()],
        bump,
        space = MarketData::LEN,
    )]
    pub market_data: Account<'info, MarketData>,

    pub market_key: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 0,
        seeds = [b"treasury_account", market_key.key().as_ref()],
        bump,
        owner = system_program::ID,
    )]
    pub treasury_account: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}



#[derive(Accounts)]
pub struct BuyTickets<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub market_key: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"market_data", market_key.key().as_ref()],
        bump,
    )]
    pub market_data: Account<'info, MarketData>,

    #[account(
        mut,
        seeds = [b"treasury_account", market_key.key().as_ref()],
        bump,
    )]
    pub treasury_account: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        seeds = [b"user_tickets", market_data.key().as_ref(), payer.key().as_ref()],
        bump,
        space = UserTickets::LEN,
    )]
    pub user_tickets: Account<'info, UserTickets>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeMarket <'info> {
    pub authority: Signer<'info>,
    pub market_key: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"market_data", market_key.key().as_ref()],
        bump,
    )]
    pub market_data: Account<'info, MarketData>,
}

#[derive(Accounts)]
pub struct ClaimReward<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub market_key: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"market_data", market_key.key().as_ref()],
        bump,
    )]
    pub market_data: Account<'info, MarketData>,

    #[account(
        mut,
        seeds = [b"treasury_account", market_key.key().as_ref()],
        bump,
    )]
    pub treasury_account: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"user_tickets", market_data.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub user_tickets: Account<'info, UserTickets>,

    #[account(mut)]
    pub project_treasury: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

// Data Structures
#[account]
pub struct MarketData {
    pub title: String,
    pub description: String,
    pub side_a: String,
    pub side_b: String,
    pub category: String,

    pub ticket_price: u64,

    pub duration: u64,
    pub creation_time: u64,

    pub encryptor: String,

    pub treasury_address: Pubkey,
    pub creator: Pubkey,
    pub authority: Pubkey,

    pub total_tickets: u64,
    pub total_amount: u64,

    pub is_finalized: bool,
    pub is_revealed: bool,

    pub winning_side: u8, // 0 = tie (draw), 1 = side_a, 2 = side_b

    pub total_tickets_side_a: u64,
    pub total_tickets_side_b: u64,
    pub total_amount_side_a: u64,
    pub total_amount_side_b: u64,
}

impl MarketData {
    pub const MAX_TITLE_LEN: usize = 64;
    pub const MAX_DESC_LEN: usize = 512;
    pub const MAX_CATEGORY_LEN: usize = 32;
    pub const MAX_SIDE_LEN: usize = 32;
    pub const MAX_ENCRYPTOR_LEN: usize = 64;

    pub const LEN: usize = 8 // discriminator
        + 4 + Self::MAX_TITLE_LEN
        + 4 + Self::MAX_DESC_LEN
        + 4 + Self::MAX_SIDE_LEN  // side_a
        + 4 + Self::MAX_SIDE_LEN  // side_b
        + 8                       // ticket_price
        + 4 + Self::MAX_CATEGORY_LEN
        + 8                       // duration
        + 8                       // creation_time
        + 4 + Self::MAX_ENCRYPTOR_LEN
        + 32                      // treasury_address
        + 32                      // authority
        + 32                      // creator
        + 8                       // total_tickets
        + 8                       // total_amount
        + 1                       // is_finalized
        + 1                       // is_revealed
        + 1                       // winning_side
        + 8                       // total_tickets_side_a
        + 8                       // total_tickets_side_b
        + 8                       // total_amount_side_a
        + 8; // total_amount_side_b
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct UserChoiceEntry {
    pub encoded_side_hash: String,
    pub ticket_count: u64, 
    pub creation_time: u64, 
}

impl UserChoiceEntry {
    pub const MAX_ENCODED_HASH_LEN: usize = 256;
    pub const LEN: usize = 4 + Self::MAX_ENCODED_HASH_LEN // String
        + 8 // ticket_count
        + 8; // creation_time
}

#[account]
pub struct UserTickets {
    pub market: Pubkey,             
    pub user: Pubkey,              
    pub total_tickets: u64,        
    pub total_amount: u64,          
    pub choices: Vec<UserChoiceEntry>, 
    pub has_claimed: bool,          
}

impl UserTickets {
    pub const MAX_CHOICES: usize = 32;

    pub const LEN: usize = 8  // discriminator
        + 32                  // market
        + 32                  // user
        + 8                   // total_tickets
        + 8                   // total_amount
        + 1                   // has_claimed
        + 4 + Self::MAX_CHOICES * UserChoiceEntry::LEN;
}
// Error Codes

#[error_code]
pub enum EithrError {
    #[msg("Unauthorized: Only the program owner can initialize the collection.")]
    Unauthorized,
    #[msg("Overflow occurred.")]
    Overflow,
    #[msg("Not enough SOL on treasure account.")]
    InsufficientFunds,
    #[msg("Market is closed for ticket purchases.")]
    MarketClosed,
    #[msg("Encoded side hash is too long.")]
    EncodedHashTooLong,
    #[msg("Ticket count must be > 0.")]
    InvalidTicketCount,
    #[msg("User ticket limit exceeded (25% of pool or 100 absolute cap).")]
    UserTicketLimitExceeded,
    #[msg("Too many choices stored for this user in this market.")]
    TooManyChoicesForUser,
    #[msg("Market already finalized.")]
    MarketFinalized,
    #[msg("Market has not ended yet.")]
    MarketNotEnded,
    #[msg("Invalid winning side (must be 1 or 2).")]
    InvalidWinningSide,
    #[msg("Provided totals are inconsistent with stored market totals.")]
    InconsistentTotals,
    #[msg("Market is not finalized yet.")]
    MarketNotFinalized,
    #[msg("User has already claimed reward.")]
    AlreadyClaimed,
    #[msg("Invalid claim amount.")]
    InvalidClaimAmount,
    #[msg("Invalid user for this UserTickets account.")]
    UnauthorizedUser,
    #[msg("Invalid treasury PDA.")]
    InvalidTreasuryPda,
    #[msg("Invalid project treasury account.")]
    InvalidProjectTreasury,
    #[msg("Encryptor too long.")]
    EncryptorTooLong,
    #[msg("Title is too long.")]
    TitleTooLong,
    #[msg("Description is too long.")]
    DescriptionTooLong,
    #[msg("Category is too long.")]
    CategoryTooLong,
    #[msg("Side label is too long.")]
    SideTooLong,
    #[msg("Ticket price must be > 0.")]
    InvalidTicketPrice,
    #[msg("Duration must be > 0.")]
    InvalidDuration,
}
