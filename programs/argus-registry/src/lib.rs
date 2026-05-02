use crate::program::ArgusRegistry;
use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWxTWqgPfwT12r7zkbJ3Fqk7xRVE");

const ARGUS_CONFIG_SEED: &[u8] = b"argus-config";
const ARGUS_PROOF_SEED: &[u8] = b"argus-proof";
const ARGUS_REGISTRY_SCHEMA_VERSION: u16 = 1;

const PROOF_LEVEL_APP_CAPTURE: u8 = 1;
const USE_CASE_MARKETPLACE_LISTING: u8 = 1;

#[program]
pub mod argus_registry {
    use super::*;

    // kr: initialize_config는 Argus registry의 관리자와 허용된 relayer를 설정합니다.
    // en: initialize_config sets the Argus registry admin and authorized relayer.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        authorized_relayer: Pubkey,
    ) -> Result<()> {
        require!(
            authorized_relayer != Pubkey::default(),
            ArgusRegistryError::InvalidRelayer
        );

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.authorized_relayer = authorized_relayer;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    // kr: update_authorized_relayer는 관리자만 registry writer 지갑을 교체하게 합니다.
    // en: update_authorized_relayer lets only the admin rotate the registry writer wallet.
    pub fn update_authorized_relayer(
        ctx: Context<UpdateAuthorizedRelayer>,
        authorized_relayer: Pubkey,
    ) -> Result<()> {
        require!(
            authorized_relayer != Pubkey::default(),
            ArgusRegistryError::InvalidRelayer
        );

        ctx.accounts.config.authorized_relayer = authorized_relayer;
        Ok(())
    }

    // kr: update_admin은 현재 관리자 서명으로 registry admin을 교체합니다.
    // en: update_admin rotates the registry admin with the current admin signature.
    pub fn update_admin(ctx: Context<UpdateAdmin>, new_admin: Pubkey) -> Result<()> {
        require!(is_valid_admin(new_admin), ArgusRegistryError::InvalidAdmin);

        ctx.accounts.config.admin = new_admin;
        Ok(())
    }

    // kr: register_proof는 Argus가 허용한 relayer만 manifest commitment를 등록하게 합니다.
    // en: register_proof only lets an Argus-authorized relayer register manifest commitments.
    pub fn register_proof(
        ctx: Context<RegisterProof>,
        proof_id: [u8; 32],
        manifest_hash: [u8; 32],
        image_hash: [u8; 32],
        partner_id_hash: [u8; 32],
        capture_timestamp: i64,
        proof_level: u8,
        use_case: u8,
        schema_version: u16,
    ) -> Result<()> {
        validate_registration_args(
            &proof_id,
            &manifest_hash,
            &image_hash,
            &partner_id_hash,
            capture_timestamp,
            proof_level,
            use_case,
            schema_version,
        )?;
        require_keys_eq!(
            ctx.accounts.config.authorized_relayer,
            ctx.accounts.relayer.key(),
            ArgusRegistryError::UnauthorizedRelayer
        );

        let record = &mut ctx.accounts.proof_record;
        record.proof_id = proof_id;
        record.manifest_hash = manifest_hash;
        record.image_hash = image_hash;
        record.partner_id_hash = partner_id_hash;
        record.capture_timestamp = capture_timestamp;
        record.proof_level = proof_level;
        record.use_case = use_case;
        record.schema_version = schema_version;
        record.registered_at = Clock::get()?.unix_timestamp;
        record.relayer = ctx.accounts.relayer.key();
        record.status = ProofStatus::Active as u8;
        Ok(())
    }
}

fn validate_registration_args(
    proof_id: &[u8; 32],
    manifest_hash: &[u8; 32],
    image_hash: &[u8; 32],
    partner_id_hash: &[u8; 32],
    capture_timestamp: i64,
    proof_level: u8,
    use_case: u8,
    schema_version: u16,
) -> Result<()> {
    require!(!is_zero_32(proof_id), ArgusRegistryError::InvalidProofId);
    require!(
        !is_zero_32(manifest_hash),
        ArgusRegistryError::InvalidManifestHash
    );
    require!(
        !is_zero_32(image_hash),
        ArgusRegistryError::InvalidImageHash
    );
    require!(
        !is_zero_32(partner_id_hash),
        ArgusRegistryError::InvalidPartnerIdHash
    );
    require!(
        capture_timestamp > 0,
        ArgusRegistryError::InvalidCaptureTimestamp
    );
    require!(
        is_valid_proof_level(proof_level),
        ArgusRegistryError::InvalidProofLevel
    );
    require!(
        is_valid_use_case(use_case),
        ArgusRegistryError::InvalidUseCase
    );
    require!(
        schema_version == ARGUS_REGISTRY_SCHEMA_VERSION,
        ArgusRegistryError::InvalidSchemaVersion
    );

    Ok(())
}

fn is_zero_32(value: &[u8; 32]) -> bool {
    value.iter().all(|byte| *byte == 0)
}

fn is_valid_proof_level(value: u8) -> bool {
    value == PROOF_LEVEL_APP_CAPTURE
}

fn is_valid_use_case(value: u8) -> bool {
    value == USE_CASE_MARKETPLACE_LISTING
}

fn is_valid_admin(value: Pubkey) -> bool {
    value != Pubkey::default()
}

fn is_upgrade_authority(upgrade_authority: Option<Pubkey>, admin: Pubkey) -> bool {
    upgrade_authority == Some(admin)
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ ArgusRegistryError::InvalidProgramData
    )]
    pub program: Program<'info, ArgusRegistry>,

    #[account(
        constraint = is_upgrade_authority(program_data.upgrade_authority_address, admin.key())
            @ ArgusRegistryError::UnauthorizedAdmin
    )]
    pub program_data: Account<'info, ProgramData>,

    #[account(
        init,
        payer = admin,
        space = 8 + ArgusRegistryConfig::SIZE,
        seeds = [ARGUS_CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, ArgusRegistryConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAuthorizedRelayer<'info> {
    #[account(
        mut,
        seeds = [ARGUS_CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ ArgusRegistryError::UnauthorizedAdmin
    )]
    pub config: Account<'info, ArgusRegistryConfig>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateAdmin<'info> {
    #[account(
        mut,
        seeds = [ARGUS_CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ ArgusRegistryError::UnauthorizedAdmin
    )]
    pub config: Account<'info, ArgusRegistryConfig>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(proof_id: [u8; 32])]
pub struct RegisterProof<'info> {
    #[account(
        seeds = [ARGUS_CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, ArgusRegistryConfig>,

    #[account(mut)]
    pub relayer: Signer<'info>,

    #[account(
        init,
        payer = relayer,
        space = 8 + ArgusProofRecord::SIZE,
        seeds = [ARGUS_PROOF_SEED, proof_id.as_ref()],
        bump
    )]
    pub proof_record: Account<'info, ArgusProofRecord>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct ArgusRegistryConfig {
    pub admin: Pubkey,
    pub authorized_relayer: Pubkey,
    pub bump: u8,
}

impl ArgusRegistryConfig {
    pub const SIZE: usize = 32 + 32 + 1;
}

#[account]
pub struct ArgusProofRecord {
    pub proof_id: [u8; 32],
    pub manifest_hash: [u8; 32],
    pub image_hash: [u8; 32],
    pub partner_id_hash: [u8; 32],
    pub capture_timestamp: i64,
    pub proof_level: u8,
    pub use_case: u8,
    pub schema_version: u16,
    pub registered_at: i64,
    pub relayer: Pubkey,
    pub status: u8,
}

impl ArgusProofRecord {
    pub const SIZE: usize = 32 + 32 + 32 + 32 + 8 + 1 + 1 + 2 + 8 + 32 + 1;
}

pub enum ProofStatus {
    Active = 0,
    Revoked = 1,
    Superseded = 2,
}

#[error_code]
pub enum ArgusRegistryError {
    #[msg("proof_id must be a non-zero 32-byte commitment")]
    InvalidProofId,
    #[msg("manifest_hash must be a non-zero 32-byte commitment")]
    InvalidManifestHash,
    #[msg("image_hash must be a non-zero 32-byte commitment")]
    InvalidImageHash,
    #[msg("partner_id_hash must be a non-zero 32-byte commitment")]
    InvalidPartnerIdHash,
    #[msg("capture_timestamp must be positive")]
    InvalidCaptureTimestamp,
    #[msg("proof_level must map to a known Argus proof level")]
    InvalidProofLevel,
    #[msg("use_case must map to a known non-zero registry use case")]
    InvalidUseCase,
    #[msg("schema_version must match the Argus registry schema")]
    InvalidSchemaVersion,
    #[msg("relayer is not authorized to register Argus proof records")]
    UnauthorizedRelayer,
    #[msg("admin is not authorized to update this Argus registry config")]
    UnauthorizedAdmin,
    #[msg("new_admin must be a valid pubkey")]
    InvalidAdmin,
    #[msg("authorized_relayer must be a valid pubkey")]
    InvalidRelayer,
    #[msg("program_data must belong to this Argus registry program")]
    InvalidProgramData,
}

#[cfg(test)]
mod tests {
    use super::{
        is_upgrade_authority, is_valid_admin, is_valid_proof_level, is_valid_use_case,
        validate_registration_args, ARGUS_REGISTRY_SCHEMA_VERSION, PROOF_LEVEL_APP_CAPTURE,
        USE_CASE_MARKETPLACE_LISTING,
    };
    use anchor_lang::prelude::Pubkey;

    fn valid_hash(byte: u8) -> [u8; 32] {
        [byte; 32]
    }

    #[test]
    fn accepts_valid_registration_args() {
        let result = validate_registration_args(
            &valid_hash(1),
            &valid_hash(2),
            &valid_hash(3),
            &valid_hash(4),
            1_777_000_000_000,
            PROOF_LEVEL_APP_CAPTURE,
            1,
            ARGUS_REGISTRY_SCHEMA_VERSION,
        );

        assert!(result.is_ok());
    }

    #[test]
    fn only_accepts_app_capture_proof_level() {
        assert!(is_valid_proof_level(PROOF_LEVEL_APP_CAPTURE));

        for unsupported_proof_level in [0, 2, 3, 99] {
            assert!(!is_valid_proof_level(unsupported_proof_level));
        }
    }

    #[test]
    fn only_accepts_marketplace_listing_use_case() {
        assert!(is_valid_use_case(USE_CASE_MARKETPLACE_LISTING));

        for unsupported_use_case in [0, 2, 99] {
            assert!(!is_valid_use_case(unsupported_use_case));
        }
    }

    #[test]
    fn only_program_upgrade_authority_can_initialize_config() {
        let admin = Pubkey::new_unique();
        let attacker = Pubkey::new_unique();

        assert!(is_upgrade_authority(Some(admin), admin));
        assert!(!is_upgrade_authority(Some(admin), attacker));
        assert!(!is_upgrade_authority(None, admin));
    }

    #[test]
    fn admin_rotation_requires_non_default_admin() {
        assert!(is_valid_admin(Pubkey::new_unique()));
        assert!(!is_valid_admin(Pubkey::default()));
    }

    #[test]
    fn rejects_zero_commitments() {
        let result = validate_registration_args(
            &[0u8; 32],
            &valid_hash(2),
            &valid_hash(3),
            &valid_hash(4),
            1_777_000_000_000,
            PROOF_LEVEL_APP_CAPTURE,
            1,
            ARGUS_REGISTRY_SCHEMA_VERSION,
        );

        assert!(result.is_err());
    }

    #[test]
    fn rejects_unknown_schema_version() {
        let result = validate_registration_args(
            &valid_hash(1),
            &valid_hash(2),
            &valid_hash(3),
            &valid_hash(4),
            1_777_000_000_000,
            PROOF_LEVEL_APP_CAPTURE,
            1,
            ARGUS_REGISTRY_SCHEMA_VERSION + 1,
        );

        assert!(result.is_err());
    }

    #[test]
    fn rejects_unsupported_proof_levels() {
        for unsupported_proof_level in [0, 2, 3, 99] {
            let result = validate_registration_args(
                &valid_hash(1),
                &valid_hash(2),
                &valid_hash(3),
                &valid_hash(4),
                1_777_000_000_000,
                unsupported_proof_level,
                1,
                ARGUS_REGISTRY_SCHEMA_VERSION,
            );

            assert!(result.is_err());
        }
    }

    #[test]
    fn rejects_unsupported_use_cases() {
        for unsupported_use_case in [0, 2, 99] {
            let result = validate_registration_args(
                &valid_hash(1),
                &valid_hash(2),
                &valid_hash(3),
                &valid_hash(4),
                1_777_000_000_000,
                PROOF_LEVEL_APP_CAPTURE,
                unsupported_use_case,
                ARGUS_REGISTRY_SCHEMA_VERSION,
            );

            assert!(result.is_err());
        }
    }
}
